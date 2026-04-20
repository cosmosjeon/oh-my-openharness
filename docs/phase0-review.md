# Phase 0 Review Notes

This review compares the current scaffold against:

- `.omx/plans/prd-harness-editor-phase0-kickoff.md`
- `.omx/plans/test-spec-harness-editor-phase0-kickoff.md`

## What the scaffold already proves

### Canonical project shape
- Writes a stable project directory with manifest, semantic graph files, skill files, and a separate layout sidecar.
- Loader/writer round-trip is implemented in `src/core/project.ts`.

### CLI-first flow exists
- `src/index.ts` exposes `new`, `compile`, `sandbox`, and `demo` commands.
- `demo` exercises the intended Phase 0 path end-to-end.

### Claude Code compiler exists
- `src/compiler/claude.ts` emits a plugin manifest, hook config, generated scripts, generated skills, and optional MCP config.

### Isolated validation exists
- `src/sandbox/validate.ts` compiles into a temporary directory, executes generated runtime scripts, captures JSONL trace output, and renders an HTML report.

### Smoke tests exist
- `tests/generator.test.ts` checks prompt keyword expansion.
- `tests/compiler.test.ts` checks Claude package file generation.
- `tests/sandbox.test.ts` checks isolated execution and trace artifact creation.

## Gaps against the full Phase 0 spec

### 1. Registry is not yet the single generation authority
The plan/test spec asks for one authoritative registry for atomic blocks and composites. The registry exists in `src/core/registry.ts`, but `src/core/generator.ts` still hardcodes node emission instead of deriving structure from that registry.

### 2. Safety-boundary escalation is not implemented
The generator can place a `Permission` node in the graph, but there is no interactive confirmation flow or refusal path for risky changes yet. That means the current scaffold represents the boundary structurally, not behaviorally.

### 3. Representative E2E is still synthetic
Sandbox validation currently runs generated scripts with canned payloads through `spawnSync`. This is a useful isolated proof, but it is not yet a full live agent-session validation loop.

### 4. Trace schema is only partially formalized
The current trace output is stable enough for smoke validation, but the schema is not yet documented in code as a strict contract for downstream GUI/WebSocket consumers.

### 5. Test matrix coverage is still partial
The Phase 0 test spec defines 11 checks. The current automated suite covers only a focused subset:

- project generation keyword expansion
- compiler artifact presence
- isolated sandbox trace production

Remaining items still need dedicated coverage or stronger implementation:

- registry completeness as generation source of truth
- semantic/layout separation assertions
- no-manual-edit validation at the generated package level
- explicit isolation guarantees against existing local harnesses
- failure surfacing semantics for GUI consumers
- safety confirmation behavior

## Recommended next implementation moves

1. Refactor generation to derive emitted block kinds from `src/core/registry.ts`.
2. Add a real confirmation boundary for risky permission-affecting intent.
3. Promote the trace payload into a typed, documented schema shared by compiler + sandbox + future GUI consumers.
4. Expand tests to map one-to-one with the Phase 0 test-spec checklist.

## Current confidence

The scaffold is a credible Phase 0 starting point and already proves the narrow loop of:

`intent -> canonical project -> Claude package -> isolated scripted validation -> trace artifacts`

It is **not yet sufficient** to claim the full Phase 0 PRD/test-spec is complete without the gaps above being closed.
