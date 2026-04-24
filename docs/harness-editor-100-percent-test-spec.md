> Canonical OMX artifact path: `.omx/plans/harness-editor-100-percent-test-spec.md`. This tracked mirror exists because `.omx/` is gitignored in this repository; keep the `.omx/` copy as the workflow handoff path.

# Harness Editor 100% Test Specification

- Date: 2026-04-24
- Related plan: `.omx/plans/harness-editor-100-percent-master-plan.md`
- Baseline commit: `356ae9cb8355bc7e19da89e91cd72d5a36e27569`
- Scope: Phases D-J completion tests for Harness Editor V1
- Test policy: each phase must add or update tests before claiming acceptance; final release requires typecheck, full suite, golden path proof, and clean git status.

## 1. Global pass/fail gates

A later execution session may mark Harness Editor V1 complete only when all global gates pass:

1. `bunx tsc --noEmit` exits 0.
2. `bun run test` exits 0.
3. Phase-specific targeted tests listed below exit 0.
4. Golden path proof artifacts exist and are referenced from docs.
5. Existing substrate command tests remain green.
6. No source file introduces a new canonical `harness.yaml` / alternate source of truth.
7. GUI dependency additions are limited to the Phase G allowed set unless a new ADR/test justifies otherwise.
8. `git status --short` is clean after the final Lore commit.

## 2. Substrate regression suite

These tests guard the existing OMOH substrate across every phase:

| Contract | Required test coverage | Existing / new tests |
|---|---|---|
| CLI commands remain routed | help/command behavior for `setup`, `doctor`, `chat`, `author`, `new`, `import`, `compile`, `export`, `sandbox`, `serve`, `catalog`, `demo` | existing `tests/cli.test.ts`; extend only if adding aliases |
| Compiler backends still emit packages | Claude/OpenCode/Codex compile outputs and validation manifests | existing `tests/compiler.test.ts`, `tests/compiler-escaping.test.ts` |
| Sandbox isolation and trace audit | temp HOME/XDG/runtime config, trace events, failure event, schema audit | existing `tests/sandbox.test.ts`, `tests/runtime-validation.test.ts` |
| Server mutation safety | token + same-origin mutation protection | existing `tests/server-auth.test.ts`, `tests/server.test.ts` |
| Canonical project persistence | graph/layout separation, runtime intents, path/symlink guards | existing `tests/project.test.ts`, `tests/project-model.test.ts`, `tests/author-security.test.ts` |
| Import/export path safety | import seed rejects escaping/symlinked runtime roots | existing `tests/import-seed-security.test.ts` |
| Factory boundary | non-factory source does not reverse-import Factory unless consciously revised | existing `tests/factory-phase-a-b-contract.test.ts` |

Recommended helper if regressions become hard to track:
- Add `tests/substrate-regression.test.ts` as a smoke wrapper that asserts command inventory and no accidental canonical source-of-truth replacement.

## 3. Phase D — Runtime hook routing tests

### Required new/updated files

- `tests/factory-hooks.test.ts`
- `tests/fixtures/factory-hooks/session-start.json`
- `tests/fixtures/factory-hooks/user-prompt-submit.ask.json`
- `tests/fixtures/factory-hooks/user-prompt-submit.build.json`
- `tests/fixtures/factory-hooks/pre-tool-use.block.json`
- `tests/fixtures/factory-hooks/post-tool-use.project-update.json`

### Unit tests

1. `parseHookStdin accepts valid JSON and preserves raw payload preview`.
2. `parseHookStdin returns structured error for invalid JSON without crashing`.
3. `SessionStart loads Factory state and emits next recommendation`.
4. `UserPromptSubmit routes to ask-question when target runtime/capability decisions are missing`.
5. `UserPromptSubmit routes to build only when isReadyToDraft is true and user asks to build`.
6. `PreToolUse blocks unsafe/out-of-order canonical project writes before Factory readiness`.
7. `PostToolUse persists projectPath and stage when a recognized project materialization result is observed`.

### Integration tests

1. Temp Factory store roundtrip: create state → invoke hook handler → reload state → assert expected update.
2. Hook stdout contract: each hook returns host-valid JSON or documented plain text with deterministic keys.
3. Fixture coverage: every hook fixture is exercised by at least one test.

### Acceptance signal

Run:

```bash
bun test tests/factory-hooks.test.ts tests/factory-interview.test.ts tests/factory-integration.test.ts
bunx tsc --noEmit
bun run test
```

Pass when all commands exit 0 and fixtures prove state load/save + route/action handoff without modifying substrate behavior.

## 4. Phase E — Factory action orchestration tests

### Required new/updated files

- `tests/factory-actions.test.ts`
- Updates to `tests/factory-integration.test.ts`

### Unit tests

1. `draft action returns deterministic summary/spec without writing a project`.
2. `build action materializes canonical project and stores projectPath/graphHash`.
3. `preview action records URL/token/status without serializing server handle`.
4. `verify action records sandbox pass summary and trace path`.
5. `export action records runtime bundle path and runtime`.
6. `action failure stores action, error message, timestamp, and stage-safe failure state`.

### Integration tests

1. Factory state with runtime + capabilities + decisions → draft → build → compile.
2. Build → verify with sandbox pass.
3. Build → verify with forced failure and persisted failure state.
4. Build → export and assert export manifest path exists.

### Acceptance signal

Run:

```bash
bun test tests/factory-actions.test.ts tests/factory-integration.test.ts tests/sandbox.test.ts tests/compiler.test.ts
bunx tsc --noEmit
bun run test
```

Pass when action orchestration updates Factory state and all outputs are derived from canonical project files.

## 5. Phase F — Claude-native Harness Maker package tests

### Required new/updated files

- `tests/factory-claude-package.test.ts`
- Updates to `tests/runtime-setup.test.ts`
- Updates to `tests/cli.test.ts` if setup/doctor CLI output changes
- Hook fixture tests from Phase D reused
- Updates to `tests/bin-entry.test.ts` for the `harness-editor` package/bin alias if Phase F implements the alias

### Unit tests

1. `generated Claude package includes plugin.json, skills, hooks, scripts, and state contract`.
2. `plugin manifest references only files that exist inside package root`.
3. `all generated hook scripts can run with fixture stdin in temp install root`.
4. `skills contain required frontmatter and top-level orchestration instructions`.

### Integration tests

1. `setup --runtimes claude --dry-run --json` includes harness-maker package plan and no writes.
2. `setup --runtimes claude --yes` writes only to temp configured install roots in tests.
3. `doctor --runtimes claude --json` reports install shape and host readiness separately.
4. Existing setup/doctor tests remain green for Claude/OpenCode/Codex.

### Manual/optional proof

If Claude CLI is available and authenticated in a safe temp profile, capture a proof artifact:

```bash
# exact command TBD by Phase F implementation
bun run src/index.ts setup --runtimes claude --yes --json
bun run src/index.ts doctor --runtimes claude --json
```

Do not require real host credentials for automated CI; automated tests must use temp roots and fixture execution.

### Acceptance signal

Run:

```bash
bun test tests/factory-claude-package.test.ts tests/runtime-setup.test.ts tests/cli.test.ts tests/bin-entry.test.ts tests/factory-hooks.test.ts
bunx tsc --noEmit
bun run test
```

Pass when package install shape is proven without breaking existing setup/doctor behavior.

## 6. Phase G — GUI foundation tests

### Required new/updated files

- `tests/gui-client-build.test.ts`
- Updates to `tests/server.test.ts`
- Updates to `tests/gui-shell-contract.test.ts`
- Possible helper tests for graph mapping under `src/web/client/**`

### Dependency guard

Allowed additions only:

- dependencies: `react`, `react-dom`, `@xyflow/react`
- devDependencies: `vite`, `@vitejs/plugin-react`, `@types/react`, `@types/react-dom`

Test or review must fail if unrelated dependencies are added without a phase-local ADR.

### Unit/helper tests

1. `canonical graph maps to React Flow nodes/edges with stable ids`.
2. `React Flow layout updates serialize back to LayoutNode[] only`.
3. `catalog view derives blocks/composites from registry snapshot`.
4. `compatibility badges derive from registry/runtime metadata, not hardcoded UI strings`.
5. `trace/factory/chat API clients preserve server payload shapes`.

### Server/API tests

1. `GET /` serves the built GUI or fallback in development/test mode.
2. `GET /api/catalog` returns authoritative block/composite registry.
3. `GET /api/factory/state` returns current Factory state when configured.
4. `POST /api/factory/chat` routes to ask/draft/build/preview/verify/export and returns structured result.
5. `POST /api/project/skill` or equivalent inspector endpoint updates skill content safely within project root.
6. Existing `/api/project`, `/api/layout`, `/api/project/mutate`, `/api/trace`, and mutation auth tests remain green.

### Build tests

1. `bunx vite build` or `bun run build:web` exits 0.
2. Built assets are served by `startHarnessEditorServer` in a temp project.
3. TypeScript JSX configuration does not break `bunx tsc --noEmit`.

### Acceptance signal

Run:

```bash
bunx vite build   # or bun run build:web after script addition
bun test tests/gui-client-build.test.ts tests/server.test.ts tests/gui-shell-contract.test.ts tests/server-auth.test.ts
bunx tsc --noEmit
bun run test
```

Pass when React Flow GUI can render/edit canonical project data and no layout edit mutates semantic graph files.

## 7. Phase H — Live sandbox debugger tests

### Required new/updated files

- `tests/live-debugger.test.ts`
- Updates to `tests/sandbox.test.ts`
- Updates to `tests/runtime-validation.test.ts`
- Updates to `tests/server.test.ts`
- GUI trace reducer tests under client helpers

### Unit/helper tests

1. `trace event reducer marks ok nodes active and error nodes failed`.
2. `edge highlighting follows consecutive events or source/target graph relationships`.
3. `failure details are safely escaped before rendering`.
4. `stale trace detector compares event graphHash to project graphHash`.

### Stream/API integration tests

1. Trace stream endpoint emits existing trace events to a test client.
2. Appending a new trace event sends one live update without manual refresh.
3. Stream disconnect cleanup does not leak listeners/timers.
4. `/api/trace` polling fallback still works if stream is unavailable.

### Sandbox/debugger tests

1. Sandbox pass emits expected event types for representative graph.
2. Forced hook failure emits failure event and GUI/debugger API identifies failing node.
3. MCP server trace event maps to MCP node when present.
4. Hot reload/re-run seam updates graph hash and clears stale warning after rerun.
5. Release proof path can run a real isolated Claude host sandbox when host CLI/auth is available; if unavailable, the proof records a blocker and V1 100% is not claimed.

### Acceptance signal

Run:

```bash
bun test tests/live-debugger.test.ts tests/sandbox.test.ts tests/runtime-validation.test.ts tests/server.test.ts tests/gui-shell-contract.test.ts
bunx tsc --noEmit
bun run test
```

Pass when the GUI can trust live trace updates and failure localization from real sandbox output.

## 8. Phase I — Multi-runtime polish tests

### Required new/updated files

- `tests/multi-runtime-roundtrip.test.ts`
- Updates to `tests/compiler.test.ts`
- Updates to `tests/cli.test.ts`
- Updates to `tests/runtime-setup.test.ts`
- Updates to `tests/import-seed-security.test.ts` if import manifests change

### Unit tests

1. `compatibility matrix reports supported/warn/error for each runtime and block kind`.
2. `export warning is produced for runtime-incompatible nodes before writing bundle`.
3. `runtime support level metadata is exposed to API/GUI`.

### Integration tests

For each runtime `claude-code`, `opencode`, `codex`:

1. Generate canonical project.
2. Compile runtime bundle.
3. Assert manifest/config paths exist and are relative.
4. Run sandbox validation where runtime support level allows fixture execution.
5. Export bundle.
6. Import seed back into canonical project.
7. Assert graph/node/skill/runtime metadata roundtrip preserves supported semantics.

### Acceptance signal

Run:

```bash
bun test tests/multi-runtime-roundtrip.test.ts tests/compiler.test.ts tests/cli.test.ts tests/runtime-setup.test.ts tests/import-seed-security.test.ts
bunx tsc --noEmit
bun run test
```

Pass when each runtime has honest compatibility metadata and roundtrip proof appropriate to its support level.

## 9. Phase J — Docs/release readiness tests

### Required new/updated files

- `docs/harness-editor-architecture.md`
- `docs/harness-editor-troubleshooting.md`
- `docs/harness-editor-golden-path.md`
- README and Korean guide updates
- Golden path proof artifacts under `.omx/proofs/harness-editor-golden-path/` or another documented path

### Documentation checks

1. README and `docs/usage-ko.md` describe actual commands and current product name/aliases.
2. Architecture guide states canonical project files are source of truth.
3. Troubleshooting includes mutation token, setup/doctor, stale trace, hook failure, GUI build, runtime compatibility.
4. Golden path guide references exact commands and proof artifacts.
5. Docs do not claim marketplace/cloud/multi-user features as V1.
6. Docs do not present `harness.yaml` as canonical source of truth.

### Suggested doc guard command

```bash
rg -n "source of truth|harness\.yaml|canonical" README.md docs HARNESS_EDITOR_PRD.md .omx/plans/harness-editor-100-percent-master-plan.md
```

Review hits manually. `harness.yaml` may appear only as rejected/historical/import-export language, not as canonical runtime state.

### Acceptance signal

Run:

```bash
bunx tsc --noEmit
bun run test
# plus final golden path command/script defined by implementation
# plus doc guard review above
git status --short
```

Pass when docs match verified behavior and final git status is clean after the release Lore commit.

## 10. Golden Path proof specification

The final proof should be scripted as much as possible, with any unavoidable manual host step clearly labeled.

### Required proof steps

1. Create fresh temp workspace.
2. Run product entrypoint (`bunx harness-editor`, package alias, or repo-local equivalent) and record startup output.
3. Initialize/open a Factory session.
4. Submit intent: “I want a Claude harness with approval, MCP, memory, review, and retry.”
5. Answer focused interview questions until draft-ready.
6. Build canonical project.
7. Open GUI.
8. Assert GUI shows catalog, canvas, inspector, Factory state, and chat/interview panel.
9. Add/place one composite pattern.
10. Edit one Skill node markdown/frontmatter through inspector.
11. Add loop/routing logic through chat and assert graph updates.
12. Assert runtime compatibility indicators are visible.
13. Export to Claude Code package and verify install/package shape.
14. Run isolated sandbox.
15. Assert live trace highlights hook activation and state transitions.
16. Force one hook failure and assert GUI/API displays failing node and details.
17. Edit graph and hot reload/re-run or bounded rerun.
18. Export OpenCode and Codex bundles and run support-level roundtrip tests.
19. Use harness-maker to create a second harness project.
20. Run final `bunx tsc --noEmit`, `bun run test`, and `git status --short`.

### Required proof artifacts

- startup log
- Factory state JSON before/after build
- canonical project file tree
- GUI/API snapshot showing required panels
- Claude export package tree
- Real Claude-host sandbox proof log when host CLI/auth is available, or explicit blocker if unavailable
- sandbox trace JSONL and HTML report
- forced failure trace snippet
- hot reload/re-run log
- OpenCode/Codex export/import roundtrip logs
- final typecheck/test logs
- final clean git status log

### Pass criteria

- All required proof steps pass.
- No step requires manual source-code edits inside generated harness artifacts.
- Any manual host-runtime limitation is documented as support-level evidence, not hidden.

## 11. Completion checklist for later execution

- [ ] Phase D hook fixture tests pass.
- [ ] Phase E action orchestration tests pass.
- [ ] Phase F Claude package install-shape proof passes.
- [ ] Phase G React Flow GUI build/API tests pass.
- [ ] Phase H live debugger stream/failure/hot-reload tests pass.
- [ ] Phase I multi-runtime roundtrip tests pass.
- [ ] Phase J docs and golden path proof are complete.
- [ ] Existing substrate regression suite remains green.
- [ ] `bunx tsc --noEmit` passes.
- [ ] `bun run test` passes.
- [ ] Final golden path proof artifacts exist.
- [ ] `git status --short` is clean after Lore commits.
