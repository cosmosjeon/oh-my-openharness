# Harness Editor troubleshooting

This guide covers the current V1 failure modes for the `harness-editor` / `oh-my-openharness` surface.

## 1. `setup` or `doctor` looks wrong

### Symptoms

- `setup --runtimes claude --yes` fails
- `doctor --runtimes claude --json` reports warnings
- runtime install shape exists, but host readiness is still warning

### Checks

```bash
bunx harness-editor setup --runtimes claude --dry-run --json
bunx harness-editor setup --runtimes claude --yes --json
bunx harness-editor doctor --runtimes claude --json
```

What to expect:

- dry-run plans writes and makes no changes
- `setup --yes` writes the install surface
- `doctor` separates **install shape** from **host readiness**

Important: a green install shape does **not** prove authenticated host readiness.

## 2. Browser edits are rejected

### Symptom

The GUI loads, but mutations fail with a token/auth error.

### Cause

Mutating routes require the current `x-omoh-api-token` value.

### Fix

1. Start the server again:

```bash
bunx harness-editor serve --project ./my-harness
```

2. Copy the printed `apiToken`.
3. Paste it into the GUI’s **Mutation token** field.
4. Retry the edit.

Mutation protection remains `token+same-origin`.

## 3. Trace looks stale after editing the graph

### Symptom

The GUI/API reports stale trace state after a graph mutation.

### Cause

Trace events still reference the older graph hash.

### Fix

Use the bounded rerun surface:

```bash
curl -X POST \
  -H "x-omoh-api-token: <token>" \
  -H 'content-type: application/json' \
  http://127.0.0.1:<port>/api/sandbox/rerun \
  -d '{}'
```

Expected result:

- rerun completes
- stale trace clears
- trace hash matches the current project graph again

## 4. Hook/script failure is localized to the wrong place

### Checks

Run a failure-oriented sandbox pass:

```bash
bun run src/index.ts sandbox --project ./my-harness --fail-hook UserPromptSubmit
```

Then inspect:

- `trace.jsonl`
- `sandbox/report.html`
- `/api/trace`

The failure path should localize to a canonical node id and expose the failing hook/event.

## 5. GUI build or asset load fails

### Symptoms

- `/` falls back to the legacy HTML shell
- built assets are missing
- the React Flow UI does not load

### Fix

```bash
bun run build:web
bunx tsc --noEmit
```

The built client should land under `dist/web-client/`.

## 6. Runtime compatibility blocks export

### Symptoms

- export fails with compatibility errors
- a custom block only works for one runtime

### Checks

Use the compatibility API:

```bash
curl http://127.0.0.1:<port>/api/compatibility
```

Look for:

- runtime status
- node-level compatibility
- warnings/errors

Compatibility is explicit. If a custom block is Claude-only, OpenCode/Codex exports should not pretend otherwise.

## 7. `author` fails

Typical causes:

- host CLI missing
- host CLI not authenticated
- host-side quota or policy issue

Check the host directly:

```bash
claude --version
opencode --help
codex --help
```

Then re-run `doctor` for the selected runtime.

## 8. Real Claude-host proof is still blocked

### Symptom

`/api/sandbox/claude-proof` returns a blocker.

### Current contract

That is expected unless a real host lane is intentionally enabled.

The automated lane records the blocker instead of claiming that synthetic replay proves a real Claude host run.

### Check

```bash
curl http://127.0.0.1:<port>/api/sandbox/claude-proof
```

If you need a real-host attempt, run on an authenticated Claude Code host with:

```bash
HARNESS_REAL_CLAUDE_PROOF=1
```

Even then, V1 proof should stay explicit about what was actually exercised.
