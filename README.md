# oh-my-openharness

`oh-my-openharness` (OMOH) is a Bun-first CLI for AI coding-agent workflows. It sets up Claude Code / OpenCode / Codex integrations, writes a canonical harness project to disk, serves a local browser editor over that project, exports runtime-specific bundles, validates generated output, and supports a bounded import-seed path back into the canonical project.

## Current supported contract

OMOH currently supports:

- Bun-first setup via `bunx oh-my-openharness` or `oh-my-openharness setup`
- runtime selection for Claude Code, OpenCode, and Codex
- canonical project generation via `new` and host-aware authoring via `author`
- a shared browser editor that can:
  - load the canonical graph
  - add, update, and delete nodes
  - add and delete edges
  - persist layout changes
  - overlay runtime trace/debug state
- runtime-specific compile/export paths
- isolated sandbox validation with structured trace output
- bounded import-seed flow from runtime bundles back into the canonical project

Operational prerequisite honesty:

- OMOH is Bun-first for install/distribution, but generated runtime hooks and MCP bridge scripts currently execute with `node`, so **Node.js must also be available** on the machine running compiled/exported bundles.
- `author` depends on the selected host CLI being **installed and already authenticated** (`claude`, `opencode`, or `codex`).
- `serve` is intended for local use. By default it binds to loopback, and any wider exposure should be treated as an explicit security decision.

Important honesty note: the browser editor is shared across runtimes. The current explicit phase-5 serve/editor proof set is strongest for Claude/OpenCode. Codex stays green through the shared editor contract plus Codex-specific author/export/import/sandbox coverage.

## Non-goals in this repo

These remain out of scope for the shipped surface:

- marketplace packaging
- cloud execution
- full upstream feature-surface cloning for any host runtime

## Install

```bash
bun install
```

For the published package path:

```bash
bunx oh-my-openharness
```

## Commands

```text
oh-my-openharness setup   [--runtimes <claude,opencode,codex>] [--yes] [--dry-run] [--json]
oh-my-openharness doctor  [--runtimes <claude,opencode,codex>] [--json]
oh-my-openharness chat    [--name <name>] [--dir <dir>] [--runtime <claude-code,opencode,codex>]
oh-my-openharness author  --name <name> --prompt <prompt> [--dir <dir>] [--runtime <claude-code,opencode,codex>] [--confirm-risk]
oh-my-openharness new     --name <name> --prompt <prompt> [--dir <dir>] [--runtime <claude-code,opencode,codex>] [--confirm-risk]
oh-my-openharness import  --from <dir> [--name <name>] [--dir <dir>] [--runtime <claude-code,opencode,codex>]
oh-my-openharness compile --project <dir> [--out <dir>]
oh-my-openharness export  --project <dir> [--out <dir>]
oh-my-openharness sandbox --project <dir> [--out <dir>] [--fail-hook <hook>]
oh-my-openharness serve   --project <dir> [--port <port>] [--host <host>] [--trace <file>] [--api-token <token>]
oh-my-openharness catalog
oh-my-openharness demo    --name <name> --prompt <prompt> [--dir <dir>]
```

## Example flows

### 1. Run the setup wizard

```bash
bunx oh-my-openharness
```

### 2. Create a canonical project directly

```bash
bun run src/index.ts new \
  --name review-harness \
  --runtime codex \
  --prompt "Create a review harness with approvals, MCP server support, and retry loop" \
  --confirm-risk
```

### 3. Persist host-aware authoring guidance

```bash
bun run src/index.ts author \
  --name review-harness \
  --runtime codex \
  --prompt "Create a harness that keeps state, performs review loops, and exposes a browser editor" \
  --confirm-risk
```

### 4. Export and validate

```bash
bun run src/index.ts export --project .harness-editor/review-harness
bun run src/index.ts sandbox --project .harness-editor/review-harness
```

### 5. Serve the browser editor

```bash
bun run src/index.ts serve --project .harness-editor/review-harness
```

## Canonical project model

OMOH keeps semantic data separate from layout/view data:

```text
<project>/
  harness.json
  layout.json
  graph/
    nodes.json
    edges.json
  skills/
  compiler/
  sandbox/
```

Key rules:

- `graph/*.json` is the semantic source of truth
- `layout.json` is a sidecar for browser/editor coordinates
- runtime traces are treated as overlays on the canonical graph, not as a second source of structure

## Compile, export, and trace behavior

- `compile` writes runtime-specific compiler output under `compiler/`
- `export` writes repo-like runtime bundles with manifests
- `sandbox` validates generated output and emits trace artifacts consumed by the browser UI
- the server surfaces stale trace state when runtime graph identity no longer matches the current project graph

## Verification

```bash
bun run typecheck
bun run test
```

Current automated verification covers:

- runtime-specific compile/export paths for Claude/OpenCode/Codex
- setup and doctor behavior
- host-authoring bridge persistence
- browser editor mutation and layout persistence
- trace/debug payload surfacing and stale-trace detection
- import-seed flow
- published-style bin entrypoint resolution

## Related docs

- `docs/gui-shell-contract.md` — browser editor/server contract
- `docs/phase0-review.md` — historical Phase 0 review with current-gap notes
- `.omx/plans/oh-my-openharness/ACTIVE/current-state.md` — current planning/status truth for the OMOH phase chain
