# Harness Editor golden path

This document records the current verified golden-path command for Harness Editor V1 and links the generated proof artifacts.

## Product names

Current honest command surface:

- `harness-editor` — compatibility/bin alias for the Harness Editor experience
- `oh-my-openharness` — stable substrate package and legacy/public package name

Both invoke the same substrate entrypoint today.

## Proof command

Run from the repo root:

```bash
bun run scripts/harness-editor-golden-path.ts
```

That command rebuilds the web client, runs a scripted Factory interview/build flow, starts the GUI server, captures API/UI proof artifacts, edits a skill through the inspector path, records trace/failure/rerun evidence, exports a Claude bundle, runs the multi-runtime roundtrip test, and builds a second harness project.

## Current proof artifact index

Artifacts are written under:

- `proofs/harness-editor-golden-path/artifacts/`

Key files:

- `startup.log` — repo-local `harness-editor` startup output
- `factory-interview-transcript.json` — focused interview questions and answers
- `factory-state-before-build.json`
- `factory-draft.json`
- `factory-build.json`
- `factory-state-after-build.json`
- `canonical-project-tree.txt`
- `gui-shell.html`
- `gui-api-snapshot.json` — catalog, project, compatibility, Factory state, and chat payloads
- `inspector-skill-update.json`
- `graph-mutations.json`
- `claude-export.log`
- `claude-export-tree.txt`
- `sandbox-pass.json`
- `trace-stream-frame.json`
- `sandbox-failure.json`
- `trace-after-failure.json`
- `rerun-proof.json`
- `claude-host-proof.json`
- `second-harness-build.json`
- `second-harness-tree.txt`
- `multi-runtime-roundtrip.log`
- `summary.json`

## Final release verification commands

Phase J closeout also requires:

```bash
bunx tsc --noEmit
bun run test
rg -n "source of truth|harness\.yaml|canonical" README.md docs HARNESS_EDITOR_PRD.md .omx/plans/harness-editor-100-percent-master-plan.md
git status --short
```

The final typecheck/test/git-status outputs are recorded in the same proof directory during release closeout.

## What the scripted proof demonstrates

The current script proves:

1. repo-local `harness-editor` entrypoint launches the same stable substrate
2. Factory interview state reaches draft/build readiness
3. canonical project materialization succeeds
4. GUI/API surface exposes catalog, inspector, compatibility, Factory state, and chat payloads
5. inspector skill edits persist to disk
6. graph mutations are accepted through the protected editor API
7. Claude export package shape exists
8. sandbox traces stream and localized failures are visible
9. stale trace clears after bounded rerun
10. support-level OpenCode/Codex roundtrip coverage stays green via automated test
11. harness-maker can create a second harness project

## Explicit blocker policy

`claude-host-proof.json` may record a **blocked** real Claude host proof in the automated lane.

That is intentional honesty, not a failure to collect evidence. Synthetic replay is not treated as sufficient evidence for a real authenticated Claude-host release claim.
