# GUI Shell Contract (current browser editor)

This document describes the **current** browser surface shipped in OMOH. It is no longer a layout-only viewer. The browser app is a real editor over the canonical harness project on disk, with runtime trace/debug overlays layered on top.

The three data surfaces that must stay aligned are:

- the canonical project on disk (`harness.json`, `graph/*.json`, `layout.json`)
- the runtime trace/debug artifacts produced by sandbox validation
- the browser state loaded from the local OMOH server

If those surfaces drift, the browser stops being a trustworthy editor/debugger and becomes a second model of the project. The contract below exists to prevent that.

---

## 1. Scope

In scope today:

- local HTTP server from `src/web/server.ts`
- browser editor HTML from `src/web/viewer.ts`
- project load via `loadHarnessProject`
- layout persistence
- graph mutations through HTTP endpoints
- trace/debug polling and stale-trace surfacing
- rendering of authoring summary and confirmation state in the browser

Explicitly out of scope today:

- WebSocket/live trace streaming
- GUI-triggered runtime setup / compile / export / sandbox execution
- GUI-side approval/denial of risky confirmation requests
- live host-runtime conversation inside the browser
- collaborative editing or multi-user conflict handling

The authoritative authoring/runtime surfaces remain the CLI plus the selected host runtime. The browser edits the canonical project and visualizes trace/debug state; it does not replace runtime-native authoring.

---

## 2. Boundary rules

- The browser/editor does **not** maintain a shadow project model.
- `GET /api/project` always reloads from disk.
- Trace payloads are overlays only; they do not define graph structure.
- Layout remains separate from semantic graph state.
- Browser mutations write back through the canonical project persistence path, not through ad hoc JSON file surgery.
- Editor mutations must preserve host-authored authoring context and already-confirmed risk gates when graph-derived state is refreshed.

That last rule is enforced in `src/web/server.ts` by merging refreshed derived state with preserved non-derived authoring fields before writing the project back out.

---

## 3. HTTP contract

All routes are local-only and served by `startHarnessEditorServer(...)`.

### `GET /`

Returns the single-page browser editor HTML.

### `GET /api/health`

Returns basic server liveness and project path.

### `GET /api/project`

Returns the current canonical project payload, including:

- manifest
- nodes / edges / layout
- composites / customBlocks / registry snapshot
- authoring state
- runtime intents

### `GET /api/trace`

Returns the trace payload with:

- `source`
- `path`
- `events`
- optional `error`
- `staleTrace`
- `expectedGraphHash`
- `observedGraphHash`

Trace discovery currently checks, in order:

1. explicit `tracePath`
2. `<projectDir>/trace.jsonl`
3. `<projectDir>/compiler/<runtime>/trace.jsonl`
4. `<projectDir>/sandbox/trace.jsonl`

### `POST /api/layout`

Persists layout-only changes.

### `POST /api/project/mutate`

Supports real editor mutations on the canonical graph:

- `add-node`
- `update-node`
- `delete-node`
- `add-edge`
- `delete-edge`

Current guardrails:

- generic `add-node` rejects `Skill` nodes; runtime authoring owns those
- edge endpoints must already exist in the canonical graph
- unknown node/edge ids are rejected

---

## 4. Viewer/editor behavior

The browser currently exposes:

- node list and project summary
- confirmation list (read-only)
- selected-node label/config editing
- add/delete node controls
- add/delete edge controls
- save-layout button
- runtime trace/debug side panel
- node highlight from runtime status

Highlight behavior is trace-driven:

- error events mark nodes as error
- active events mark nodes as active
- custom blocks retain special styling
- stale trace is surfaced explicitly when graph hashes diverge

The browser polls trace state on an interval rather than streaming it.

---

## 5. Current data-flow truth

```text
canonical project on disk  ---> /api/project ---> browser editor state
runtime trace artifacts    ---> /api/trace   ---> browser trace/debug state
browser layout/graph edits ---> /api/layout or /api/project/mutate ---> canonical project on disk
```

Important implications:

- browser edits are first-class project mutations, not temporary UI-only state
- runtime trace/debug overlays are tied back to canonical node ids and graph hashes
- stale trace is a supported state, not a silent failure mode

---

## 6. What changed relative to the earlier GUI-second slice

The old GUI-second documentation is no longer accurate in these areas:

- the browser is **not** layout-only anymore
- graph mutation endpoints now exist
- editor controls for node/edge changes now exist in the shipped UI
- trace artifacts can be written under the project and are checked for graph-hash freshness
- the server now preserves host-authored authoring summary/warnings and confirmed risk-gate state across safe editor mutations

Those behaviors are covered by the current server/browser tests, especially `tests/server.test.ts` and `tests/gui-shell-contract.test.ts`.

---

## 7. Remaining limitations

The browser/editor is still intentionally bounded:

1. **No live runtime session in the browser**  
   Host-native authoring still belongs to Claude/OpenCode/Codex, not to this page.

2. **No browser-side approval workflow**  
   Confirmation requests are visible in the browser, but risk-bearing approvals still belong to CLI/runtime flows.

3. **Polling, not streaming**  
   Trace updates are fetched periodically, not pushed.

4. **Single-user local workflow**  
   There is no concurrency/version handshake for simultaneous browser/CLI editing.

5. **Runtime-proof asymmetry still exists at the scenario level**  
   The shared editor contract is common across runtimes, but the explicit phase-5 serve/editor scenario proofs are currently Claude/OpenCode-heavy while Codex stays green through shared editor coverage plus Codex author/export/import/sandbox proofs.

---

## 8. Verification anchors

The current contract is grounded by:

- `tests/server.test.ts`
- `tests/gui-shell-contract.test.ts`
- `tests/host-authoring.test.ts`
- `tests/phase5-proof-audit.test.ts`

Use those tests plus the current `.omx/plans/oh-my-openharness/*` status artifacts when judging whether the browser/editor contract is still being described honestly.
