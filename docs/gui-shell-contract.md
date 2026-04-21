# GUI Shell Contract (GUI-Second Slice)

This document defines the contract for the minimal local viewer/editor surface introduced on top of the Phase 0 CLI-first scaffold. It is the review/docs counterpart to the implementation and test lanes that add `src/web/server.ts` and `src/web/viewer.ts`.

The contract exists to keep three data surfaces in agreement:

- the **canonical harness project** on disk (written by `src/core/project.ts`)
- the **runtime trace output** produced by `src/sandbox/validate.ts`
- the **viewer state** held in the browser after it loads server payloads

If any one of those surfaces drifts, the GUI stops being a faithful view of the project and becomes another generator that can lie.

---

## 1. Scope of this slice

In scope:

- A localhost HTTP server that reads the canonical project and exposes it to a browser viewer.
- A single-page SVG viewer that renders nodes and edges from stored layout and overlays runtime trace status.
- A narrow layout-persistence endpoint so drag-and-drop changes survive a reload.

Explicitly out of scope for this slice (deferred per `HARNESS_EDITOR_PRD.md` §7.3–§7.4):

- WebSocket streaming of live sandbox events.
- Chat-driven graph mutation from the GUI.
- Node add/delete/connect operations.
- Skill/manifest editing from the GUI.
- Hot reload of the sandbox from a GUI action.
- Approval/denial of `confirmationRequests` from the GUI.

The CLI (`new`, `compile`, `sandbox`, `demo`, `catalog`, `chat`) remains the authoritative authoring and validation surface. The GUI shell is strictly read-mostly with a single layout write.

---

## 2. Boundary rules

- No file outside `src/web/` is modified by the GUI slice.
- `src/core/*`, `src/compiler/*`, and `src/sandbox/*` stay owned by the CLI loop.
- The GUI loads projects via `loadHarnessProject` only — it does not define its own project reader.
- The GUI does not invoke the compiler or sandbox. Those run from the CLI; the GUI observes their artifacts.

This boundary preserves the PRD principle *harness-first, GUI-second* (§4.2).

---

## 3. HTTP contract

All routes are local-only, JSON over HTTP, no auth, no CORS required. Served from `startHarnessEditorServer({ projectDir, port?, host?, tracePath? })`.

### 3.1 `GET /` and `GET /index.html`

- Returns the viewer HTML shell (`renderViewerHtml(projectName)`).
- Content-Type: `text/html; charset=utf-8`.
- Cache-Control: `no-store`.

### 3.2 `GET /api/health`

Response:

```json
{ "ok": true, "projectDir": "<absolute path>" }
```

### 3.3 `GET /api/project`

Reloads the canonical project on every request (no caching). Response shape (`ProjectPayload`):

```ts
{
  manifest:        HarnessManifest,
  nodes:           GraphNode[],
  edges:           GraphEdge[],
  layout:          LayoutNode[],
  composites:      CompositeInstance[],
  customBlocks:    CustomBlockDefinition[],
  registry:        RegistrySnapshot,
  authoring:       AuthoringDecision,
  runtimeIntents:  RuntimeIntent[]
}
```

All types come from `src/core/types.ts`. The payload is exactly the subset of `HarnessProject` a viewer needs — skills content is intentionally omitted because the viewer does not edit skill markdown in this slice.

### 3.4 `GET /api/trace`

Response (`TracePayload`):

```ts
{
  source: 'trace-file' | 'sandbox-report' | 'none',
  path:   string | null,
  events: TraceEvent[],
  error?: string
}
```

Trace file discovery order:

1. `options.tracePath` if supplied to `startHarnessEditorServer`
2. `<projectDir>/trace.jsonl`
3. `<projectDir>/compiler/claude-code/trace.jsonl`
4. `<projectDir>/sandbox/trace.jsonl`

If none exist, returns `{ source: 'none', path: null, events: [] }`. Partial/invalid JSONL returns `error` but still 200, so the viewer can render an empty trace state instead of erroring the shell.

`TraceEvent` shape is locked in `src/core/types.ts` and mirrored at compile time in `<pluginRoot>/trace-schema.json`.

### 3.5 `POST /api/layout`

Body:

```json
{ "layout": [ { "id": "<node-id>", "x": <number>, "y": <number> }, ... ] }
```

Behavior (`persistLayout` in `src/web/server.ts`):

- Only ids that exist on `project.nodes` are accepted; unknown ids are silently dropped.
- Existing layout entries are updated in-place; entries for ids not present in the body are preserved.
- Writes `<projectDir>/layout.json` via `writeFile` (full replace, not atomic).
- Response: `{ ok: true, layout: LayoutNode[] }` — the merged layout after persistence.

Validation errors return 400 with `{ error: string }`. Write/read errors return 500.

---

## 4. Viewer state model

The browser script keeps a single `state` object:

```ts
state = {
  project: ProjectPayload | null,
  trace:   TracePayload,
  dirty:   boolean,             // a drag moved at least one node
  dragNodeId: string | null,
  activeNodes: Set<string>,     // derived from trace (status: 'ok')
  errorNodes: Set<string>       // derived from trace (status: 'error')
}
```

Rendering pipeline:

1. `loadProject()` → `GET /api/project` → `renderProject()` lays out `nodes` + `edges` from `layout`.
2. `loadTrace()` → `GET /api/trace` → `renderTrace()` computes `activeNodes` / `errorNodes` from `events[*].nodeId` and re-renders the SVG.
3. A 4-second interval polls `/api/trace` unless a drag is in progress.
4. `Save layout` POSTs the current `project.layout` back to `/api/layout`.

Highlight rules:

- `node.id ∈ state.errorNodes` → red stroke on the node rect.
- `node.id ∈ state.activeNodes` → green stroke.
- `node.kind === 'CustomBlock'` → dashed amber stroke regardless of trace status.
- Edge between two nodes both in `activeNodes` → blue accent stroke.

The viewer never mutates `project.nodes`, `project.edges`, `project.composites`, or `project.authoring`. The only writable slice is `project.layout`.

---

## 5. Data flow between the three surfaces

```
canonical project (disk)            trace output (sandbox)          viewer state (browser)
─────────────────────────           ─────────────────────           ──────────────────────
harness.json                ──┐                                        manifest
graph/nodes.json            ──┼─> loadHarnessProject() ──┐             nodes, edges, composites
graph/edges.json            ──┤                          │
graph/composites.json       ──┤                          │
layout.json                 ──┤                          ├─> /api/project ─> state.project
custom-blocks/              ──┤                          │
registry/                   ──┤                          │
authoring/decision.json     ──┤                          │
runtime.json                ──┘                          │
                                                         │
<sandbox>/trace.jsonl  ─> readTraceFile() ──────────────┴─> /api/trace  ─> state.trace
                                                                              │
                                                                              └─> activeNodes / errorNodes
```

The canonical project is the only source of graph structure. Trace only contributes runtime status overlays. Viewer-initiated writes flow back to `layout.json` only.

---

## 6. Architecture gaps between the three surfaces

These are the concrete mismatches and coupling gaps found while reviewing the slice. Each one has a short description, an impact, and a bounded recommendation. None of them require breaking the CLI/compiler/sandbox loop to fix.

### 6.1 Trace file location is not in the project

- `validateProject` writes trace output to a fresh `mkdtemp(os.tmpdir(), 'harness-editor-')` directory. None of the server's auto-discovery candidates (`<projectDir>/trace.jsonl`, `<projectDir>/compiler/claude-code/trace.jsonl`, `<projectDir>/sandbox/trace.jsonl`) will find that file.
- Impact: `/api/trace` returns `{ source: 'none' }` after every sandbox run unless the CLI user also passes `--out` to materialize the trace under the project, or the server user passes `tracePath` explicitly.
- Recommendation: either (a) make `validateProject` copy `trace.jsonl` and `trace-report.html` into `<projectDir>/sandbox/` on completion, or (b) add a `sandbox` CLI flag that writes the trace path to `<projectDir>/.harness-editor/last-run.json` that the server can discover.

### 6.2 Hook-level trace events use kind-as-id, not canonical node id

- The compiler-generated hook scripts (`src/compiler/claude.ts` line 46) emit the hook activation event as `nodeId: '<HookEvent>'` (e.g. `'SessionStart'`). The generator, however, gives that same node an id like `sessionstart-1`.
- The per-node events inside the hook script (`Skill`, `Permission`, `Loop`, `StateWrite`, `CustomBlock`) correctly use `node.id`.
- The MCP server script emits `nodeId: 'MCPServer'` (line 132), but the canonical node id is `mcp-server`.
- Impact: the viewer's `activeNodes` / `errorNodes` sets built from trace `nodeId` will miss every hook-activation event and every MCP event, so those canonical nodes never light up. Trace shows green in the side panel but the canvas stays cold.
- Recommendation: have the compiler resolve `node.id` for the hook-kind node at compile time and substitute that into the generated script, and do the same for the MCP entry. Keep the `eventType` and `hook` fields unchanged — those remain keyed by hook vocabulary.

### 6.3 `TraceEvent` schema is informally enforced

- `src/compiler/claude.ts` writes `<pluginRoot>/trace-schema.json` with `version: 1` and a `requiredFields` list, but nothing at runtime validates events against it. The viewer silently coerces missing fields via `escapeHtml(undefined) → ''`.
- Impact: schema drift between compiler hook scripts, sandbox `appendTraceEvent` calls, and the viewer's expectations is not caught until a human notices a missing column.
- Recommendation: promote `TraceEvent` to the compiler contract (`src/core/types.ts` already defines it) and add a dev-time validator invoked by the sandbox before it appends to the trace file. Surface schema version in `/api/trace` so the viewer can refuse to render an unknown major.

### 6.4 Layout persistence has no concurrency control

- `POST /api/layout` reads the project, merges, and writes `layout.json` with no version check, no lock, no etag.
- Impact: if the CLI regenerates the project (`new ... --name <same>`) while a viewer has a drag buffered, the layout write-back silently overwrites the regenerated layout. Low probability in single-user local dev, but it is a correctness gap.
- Recommendation: include `manifest.schemaVersion` + a monotonic `project.updatedAt` in `/api/project`, require the body to echo it back, reject mismatches with 409.

### 6.5 Polling instead of streaming

- The viewer polls `/api/trace` every 4 seconds. PRD §10.1.5 and §15.2 describe a WebSocket sync layer for live trace.
- Impact: live flow visualization lags by up to 4 s, trace file is fully re-read on every poll, and there is no way to stream an in-progress sandbox run.
- Recommendation: deferred to the Phase 2 GUI milestone. For this slice, document the polling cadence in the shell contract (done, here) and add `Last-Modified` on `/api/trace` so a future client can short-circuit.

### 6.6 Confirmations surface is read-only

- The viewer renders `authoring.confirmationRequests` but offers no way to act on them. PRD §13.1 requires explicit confirmation for risk-bearing permissions, safety changes, and destructive runtime, but only the CLI `chat` command can currently satisfy that.
- Impact: a user who sees a pending confirmation in the GUI has to switch back to CLI to resolve it, which is the intended behavior per the PRD risk boundary but needs to be called out in the viewer copy ("Resolve in CLI: `harness-editor chat`").
- Recommendation: update the empty-state copy to point users at the CLI. Do not add a POST endpoint for confirmations in this slice; it would cross the PRD risk boundary without a supporting interactive flow.

### 6.7 No cross-surface consistency check

- Canonical project, compiled plugin, and trace file can all disagree (e.g. project has a `Loop` node that was later removed; compiled plugin still has the old `scripts/*.mjs`; trace emits events for the removed node id).
- Impact: the viewer would show trace activity for a node that does not exist on the canvas, silently ignored by `findLayout()`.
- Recommendation: add a `project.hash` or `project.graphHash` (hash of `nodes` + `edges`) into both the compiled `plugin.json` and into every emitted trace event. The server can then annotate `/api/trace` with `{ staleTrace: true }` when hashes diverge.

---

## 7. Risk boundaries pinned from `HARNESS_EDITOR_PRD.md`

The GUI-second slice respects these PRD-level boundaries (unchanged by this document):

- §4.1 No-code first — viewer does not edit hook scripts, plugin manifests, or runtime config.
- §4.2 Harness-first, GUI-second — viewer is read-mostly over an existing project.
- §10.2 Source of truth is the project on disk — `/api/project` reloads; the server does not hold an in-memory canonical copy.
- §10.3 Layout lives in a sidecar — layout writes stay inside `layout.json` and do not touch `graph/*.json`.
- §13.1 AI autonomy boundary — the GUI does not confirm or approve risk-bearing permissions. Those remain CLI-only for this slice.
- §15.1 Sandbox isolation — the viewer consumes trace output only; it never spawns, restarts, or writes into the sandbox.

Any future GUI action that would violate one of these boundaries should be re-scoped back to the CLI or gated through a new PRD-level decision.

---

## 8. Verification hooks (for the integration lane)

The test/verification lane should at minimum cover:

- `GET /api/project` round-trips the shape of `loadHarnessProject` including registry + authoring.
- `GET /api/trace` returns `source: 'none'` when no trace file exists and `source: 'trace-file'` with correct path when one does.
- `POST /api/layout` rejects non-array bodies with 400, persists valid bodies, and ignores unknown node ids.
- `loadTracePayload` prefers an explicit `tracePath` over auto-discovery.
- Viewer HTML payload contains the project name and exposes the four panel regions (`summary`, `confirmations`, `node-list`, `trace-list`).

These are implementation tests and belong in `tests/` under the implementation lane, not in this review doc.
