# Harness Editor architecture

Harness Editor V1 is an additive product layer over the existing `oh-my-openharness` substrate.

## Source of truth

The canonical project on disk remains the only project source of truth:

- `harness.json`
- `graph/nodes.json`
- `graph/edges.json`
- `layout.json`
- `runtime.json`
- `skills/`
- `registry/`
- `authoring/`

The browser, Factory state, and sandbox traces may cache or visualize state, but they must not replace canonical project files. `writeHarnessProject` and `loadHarnessProject` remain the persistence boundary.

## Layer map

### 1. Substrate CLI

The stable substrate lives under `src/index.ts`, `src/core/`, `src/compiler/`, and `src/sandbox/`.

It owns:

- `setup` / `doctor`
- canonical project generation (`new`, `author`)
- `compile` / `export`
- `sandbox`
- `serve`
- `catalog`

Public entrypoints currently remain:

- `oh-my-openharness`
- `harness-editor` (compatibility/bin alias to the same substrate)

### 2. Harness Factory

The Factory layer lives under `src/factory/`.

It owns:

- conversational state storage
- reference pattern search
- focused interview questions
- draft graph synthesis
- orchestration for `draft`, `build`, `preview`, `verify`, and `export`
- Claude-native harness-maker package generation

The Factory does not introduce a parallel IR. It converts conversation state into canonical project files through the existing substrate.

### 3. GUI/editor

The GUI layer lives under `src/web/`.

It owns:

- the React/React Flow editor client
- catalog and inspector panels
- Factory state and chat panel
- compatibility badges
- live trace/debug overlay
- mutation-token-protected graph and skill edits

The GUI is a synchronized editor over the canonical project. Runtime traces are overlays only.

### 4. Sandbox/debugger

The sandbox/debugger path lives across `src/sandbox/validate.ts`, `src/sandbox/claude-proof.ts`, and the server trace endpoints.

It owns:

- isolated validation runs
- trace file generation
- stale trace detection via graph hash mismatch
- SSE trace streaming with polling fallback semantics on the client
- bounded rerun (`/api/sandbox/rerun`)
- explicit real-Claude-host proof blocking when synthetic replay is the only evidence

### 5. Runtime backends

Runtime support is explicit and compatibility-scoped:

- Claude Code
- OpenCode
- Codex

`src/core/runtime-compatibility.ts` and the export/compile paths keep support claims honest.

- Claude: host-installable proof level
- OpenCode/Codex: support-level roundtrip proof anchored by automated export/import coverage

## End-to-end flow

1. User enters through `harness-editor` or `oh-my-openharness`.
2. Factory interview/refinement captures intent.
3. Factory build materializes a canonical project on disk.
4. GUI loads the canonical project and exposes catalog/canvas/inspector/chat.
5. Sandbox produces traces; GUI localizes activity and failure by canonical node id.
6. Export emits runtime-specific bundles from canonical project files.

## Design constraints

- No new canonical `harness.yaml` or replacement IR.
- Browser edits must round-trip through the canonical persistence path.
- Existing substrate commands must keep working.
- Runtime claims must match proof level, not aspiration.
- Synthetic replay is not enough to claim real Claude host proof.

## Verification anchors

The current architecture description is grounded by:

- `tests/factory-hooks.test.ts`
- `tests/factory-claude-package.test.ts`
- `tests/gui-client-build.test.ts`
- `tests/gui-shell-contract.test.ts`
- `tests/live-debugger.test.ts`
- `tests/multi-runtime-roundtrip.test.ts`
- `tests/runtime-setup.test.ts`
- `tests/cli.test.ts`
