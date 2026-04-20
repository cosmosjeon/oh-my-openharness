# Harness Editor

Harness Editor is the Phase 0 scaffold for a **CLI-first harness-maker**.
It turns an intent prompt into a canonical harness project on disk, compiles that project into a Claude Code plugin package, and validates the generated runtime in an isolated sandbox with structured trace output.

## Current Phase 0 slice

Implemented in this scaffold:

- CLI entrypoint with `new`, `compile`, `sandbox`, and `demo` commands
- Canonical project files on disk:
  - `harness.json`
  - `graph/nodes.json`
  - `graph/edges.json`
  - `layout.json`
  - `skills/*.md`
- Authoritative block/composite registry definitions in `src/core/registry.ts`
- Claude Code compiler output:
  - `.claude-plugin/plugin.json`
  - `hooks/hooks.json`
  - generated hook scripts in `scripts/*.mjs`
  - generated skills in `skills/<skill>/SKILL.md`
  - optional `.mcp.json` + `scripts/mcp-server.mjs`
- Isolated sandbox validation that executes generated scripts and emits trace artifacts:
  - `trace.jsonl`
  - `trace-report.html`

Not yet complete relative to the full product PRD:

- keyword-based generation is still heuristic, not a full intent planner
- the generator does not yet consume the registry as the sole source of emitted graph structure
- permission/risk confirmation is represented in the graph, but no interactive confirmation flow exists yet
- sandbox validation is a representative script execution pass, not a full live Claude Code session

## Install

```bash
bun install
```

## Commands

### Create a canonical project

```bash
bun run src/index.ts new \
  --name review-harness \
  --prompt "Create a review harness with approvals, MCP server support, and retry loop"
```

This writes a project under `.harness-editor/<name>` by default.

### Compile to a Claude Code package

```bash
bun run src/index.ts compile --project .harness-editor/review-harness
```

### Validate in an isolated sandbox

```bash
bun run src/index.ts sandbox --project .harness-editor/review-harness
```

### Run the golden-path demo

```bash
bun run src/index.ts demo \
  --name demo-harness \
  --prompt "Create a review harness with approval and mcp server"
```

## Canonical project model

Phase 0 keeps semantic data separate from view/layout data:

```text
<project>/
  harness.json            # manifest / prompt / runtime target
  layout.json             # visual layout sidecar only
  graph/
    nodes.json            # semantic nodes
    edges.json            # semantic edges
  skills/
    <name>-skill.md       # generated skill content
  custom-blocks/          # reserved for opaque/generated blocks
  compiler/               # compiler output root
```

`layout.json` is intentionally separate from `graph/*.json` so CLI/compiler/runtime behavior does not depend on editor coordinates.

## Prompt-to-node heuristics

The current generator (`src/core/generator.ts`) always emits this base flow:

- `SessionStart`
- `UserPromptSubmit`
- `Skill`
- `Sequence`
- `Stop`

Additional nodes are added from prompt keywords:

- approval / approve / permission / 승인 / 권한 → `Permission`
- mcp / server / tool / 서버 / 도구 → `MCPServer`
- retry / loop / review / 반복 / 검토 → `Loop`
- state / memory / 상태 / 기억 → `StateWrite`
- custom / novel / opaque / 새로운 / 신규 → `CustomBlock`

## Claude compiler outputs

`src/compiler/claude.ts` emits a Claude Code-compatible package structure:

- `.claude-plugin/plugin.json` with skill directory metadata
- `hooks/hooks.json` for generated hook commands
- `scripts/<Hook>.mjs` for enabled runtime hooks
- `skills/<skill>/SKILL.md` for generated behavior
- `.mcp.json` plus `scripts/mcp-server.mjs` when an MCP node is present

Generated hook scripts append JSONL trace records when `HARNESS_EDITOR_TRACE_FILE` is set.

## Trace contract (current scaffold)

The sandbox validator executes generated scripts with canned payloads and writes JSON Lines events. Current emitted fields are:

- `timestamp`
- `hook`
- `nodeId`
- `status`
- `message`
- `payloadLength` (hook scripts only)

An HTML summary is rendered by `src/web/report.ts` for quick inspection.

## Verification

```bash
bun run test
bun run typecheck
```

See `docs/phase0-review.md` for a review of what the current scaffold covers versus the full Phase 0 PRD/test-spec matrix.
