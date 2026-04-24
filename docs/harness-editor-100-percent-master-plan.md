> Canonical OMX artifact path: `.omx/plans/harness-editor-100-percent-master-plan.md`. This tracked mirror exists because `.omx/` is gitignored in this repository; keep the `.omx/` copy as the workflow handoff path.

# Harness Editor 100% Master Execution Plan

- Date: 2026-04-24
- Mode: `$ralplan --deliberate`
- Session purpose: planning only; no Phase D/E/F/G/H/I/J implementation in this session
- Start cwd: `/Users/cosmos/Documents/harness`
- Baseline commit: `356ae9cb8355bc7e19da89e91cd72d5a36e27569` (`356ae9c Complete the Factory interview path into substrate handoff`)
- Baseline verification supplied by user: `bunx tsc --noEmit` green; `bun run test` green, 101 pass / 0 fail
- Baseline `git status --short`: clean before this planning artifact work
- Companion test spec: `.omx/plans/harness-editor-100-percent-test-spec.md`
- Context snapshot: `.omx/context/harness-editor-100-percent-master-plan-20260424T062423Z.md`

## 0. Non-negotiable execution boundaries

1. **Keep the existing OMOH substrate.** The low-level commands remain the engine: `new`, `author`, `serve`, `sandbox`, `export`, `import`, `compile`, `setup`, `doctor`.
2. **Canonical project model remains the source of truth.** `harness.json`, `graph/*.json`, `layout.json`, `runtime.json`, `skills/`, `registry/`, and `authoring/` remain canonical. Do not introduce `harness.yaml` or any other parallel source of truth. If a YAML view is ever needed, it must be an import/export representation derived from the canonical project.
3. **Factory is additive.** Harness Factory stays under `src/factory/` and calls existing core/compiler/web/sandbox adapters instead of replacing them.
4. **Reference harnesses are pattern sources, not runtime dependencies.** `oh-my-codex/`, `oh-my-claudecode/`, `oh-my-openagent/`, `ouroboros/`, `superpowers/`, and `gstack/` should inform patterns/provenance only when needed.
5. **Dependency discipline.** No new dependencies except the planned GUI stack in Phase G: React, React DOM, `@xyflow/react`, Vite, Vite React plugin, and React type packages. Any additional streaming/testing/runtime dependency must get a phase-local ADR and explicit acceptance test.
6. **Per-phase commit boundary.** Each implementation phase must land as its own Lore commit with verification evidence. Do not batch D-J into one commit.
7. **No broad replan during execution.** Later `$ralph --prd` or `$team` runs should execute this plan, refine only discovered details inside the stated boundaries, and avoid reopening the already-set product direction.

## 1. Evidence summary from required reading

### Documents read in required order

1. `AGENTS.md` — workspace expects proactive subagent use, evidence-backed verification, document changed files/risks.
2. `README.md` — current product is `oh-my-openharness`; stable substrate commands and Factory in-progress layer are documented.
3. `docs/usage-ko.md` — Korean guide confirms current OMOH flow, current Factory layer, local editor capabilities, and no source-of-truth replacement.
4. `docs/harness-factory-plan.md` — lays out Factory A-G concept and says next slice after Phase C is hook routing without substrate rewiring.
5. `docs/harness-factory-phase-a-b-review.md` — locks additive `src/factory/` direction and stable substrate command regression guard.
6. `HARNESS_EDITOR_PROPOSAL.md` — original market/product proposal; includes older `harness.yaml` language now superseded by PRD/user direction.
7. `HARNESS_EDITOR_PRD.md` — locks chat-first harness-maker, canonical project on disk, GUI as synchronized layer, live sandbox debugger, and no-code promise.
8. `seed_harness_editor.yaml` — useful seed/acceptance inventory, but its `harness.yaml` source-of-truth language is rejected for this repo because the user explicitly locked the canonical project model.

### Current implementation confirmed

- `src/index.ts` exposes the stable CLI commands and routes compile/export/sandbox/serve through existing core/compiler/web/sandbox modules.
- `src/core/types.ts`, `src/core/project.ts`, and `src/core/generator.ts` define and persist the canonical model, graph/layout separation, runtime intents, registry snapshots, confirmations, and custom block metadata.
- `src/compiler/claude.ts`, `src/compiler/opencode.ts`, and `src/compiler/codex.ts` emit runtime-specific packages plus validation manifests and trace schemas.
- `src/sandbox/validate.ts` compiles into an isolated temp environment, runs generated hook scripts against representative payloads, writes trace JSONL/HTML, and audits event coverage.
- `src/web/server.ts` serves canonical project/trace APIs, mutation token protection, graph mutation, layout persistence, health, and stale trace detection.
- `src/web/viewer.ts` is an inline SVG editor with node/edge mutation controls and trace overlay; it is not yet the React/React Flow GUI described in the PRD.
- `src/factory/state/`, `reference/`, `interview/`, `hooks/`, `actions/`, and `synthesis/` cover Phase A/B/C and expose `routeFactoryPrompt` as a pure Phase D seam.
- `tests/` currently guards substrate CLI/compiler/sandbox/server/setup/import/security plus Factory state/reference/interview/integration.

## 2. Definition of “100% complete” for Harness Editor V1

Harness Editor V1 is 100% complete when **all** of the following are true and verified by automated tests plus a golden-path proof:

1. **Single-command local product surface**
   - `bunx harness-editor` or a compatibility alias launches the local Harness Editor experience.
   - Existing `bunx oh-my-openharness` / `oh-my-openharness` behavior remains supported or intentionally documented as the substrate alias.
2. **Claude-native harness-maker works in CLI-only mode**
   - Setup installs a Claude Code plugin/package containing skills, hooks, manifest, and state paths.
   - In Claude, the user can describe a harness, answer focused questions, build a canonical project, preview, verify, and export without hand-editing hook code.
3. **Factory runtime hooks are real, not just pure seams**
   - `SessionStart`, `UserPromptSubmit`, `PreToolUse`, and `PostToolUse` scripts parse stdin, load/save Factory state, call routing/action seams, and produce host-valid stdout/stderr behavior.
4. **Action orchestration is stateful and failure-aware**
   - `draft`, `build`, `preview`, `verify`, and `export` call existing substrate adapters, update Factory state, and capture failures with traceable error details.
5. **GUI foundation matches the PRD**
   - React/React Flow canvas, catalog, inspector, Factory state panel, chat/interview panel, compatibility indicators, and server endpoints are present.
   - GUI edits persist to the canonical project; layout remains sidecar-only.
6. **Live sandbox debugger is trustworthy**
   - Trace events stream to the GUI, nodes/edges highlight in real time, failures are localized to graph nodes, stale traces are detected, and hot reload/re-run is supported at the defined seam.
7. **Multi-runtime export is honest and regression-guarded**
   - Claude export is install-proven.
   - OpenCode and Codex exports have compatibility metadata, install/shape proof, and import/export roundtrip tests appropriate to their support level.
8. **No-code promise holds on the golden path**
   - A user completes the representative scenario without editing `.mjs`, `.ts`, `plugin.json`, `.codex/hooks.json`, or `opencode.jsonc` by hand.
9. **Golden path passes end-to-end**
   - User runs product, sees canvas/catalog/chat, requests or places a composite, edits skill content in inspector, adds routing/loop logic through chat, sees compatibility state, exports to Claude, runs isolated sandbox, sees live graph activity/failure surfacing, edits graph, hot reloads/re-runs, and the harness-maker can produce another harness project.
10. **Release readiness is complete**
    - README, Korean usage guide, architecture guide, troubleshooting, example harness, and golden-path docs align with actual behavior.
    - `bunx tsc --noEmit`, `bun run test`, golden-path proof, and `git status --short` clean are mandatory final gates.

## 3. Current completion estimate

These percentages are planning estimates, not marketing claims. They measure current implementation against the V1 definition above.

| Area | Estimate | Evidence | Main missing work |
|---|---:|---|---|
| Stable substrate | 88% | CLI/compiler/export/import/sandbox/server/setup/doctor are implemented and heavily tested. | Real host install proof depth, final product aliasing, richer runtime compatibility metadata, live debugger/hot reload integration. |
| Factory | 52% | Phase A/B/C state, reference registry/search, interview, draft materialization, substrate adapters, and pure route seam exist. | Runtime hook scripts, action orchestrator, stateful build/verify/export failure handling, Claude-native package generation. |
| GUI | 18% | Inline SVG viewer/server supports project/trace APIs, mutations, layout persistence, and stale trace detection. | React/React Flow canvas, catalog, inspector skill editor, Factory/chat panels, compatibility UI, streaming trace UI. |
| Whole Harness Editor PRD | 35% | Strong substrate plus early Factory; PRD-critical surfaces are still missing. | Phases D-J below, especially Claude-native maker package, real GUI, live debugger, and golden path. |

## 4. RALPLAN-DR deliberate summary

### Principles

1. **Substrate preservation over reinvention** — drive `core/compiler/web/sandbox`; do not fork them.
2. **Canonical project truth over GUI/session truth** — Factory and GUI state may cache workflow context but never replace project files as the source of truth.
3. **CLI harness-maker first, GUI refinement second** — implement runtime hooks/package before treating the GUI as the primary authoring engine.
4. **Live proof over static artifact proof** — export only counts when isolated validation and trace/debug proof pass.
5. **Reference-backed, dependency-light productization** — use reference harnesses as pattern evidence and add only the minimal GUI dependency set.

### Decision drivers — top 3

1. Preserve the already-green OMOH substrate and avoid breaking existing commands.
2. Reach the PRD golden path with independently verifiable phases.
3. Keep execution handoff clear enough for `$ralph --prd` or `$team` without reopening product scope.

### Viable options

#### Option A — Sequential additive runtime-first completion (chosen)

Order: D hooks → E orchestration → F Claude package → G GUI → H live debugger → I runtime polish → J docs/release.

- Pros: respects PRD harness-first principle; each phase is testable; avoids second source of truth; safest for Ralph.
- Cons: GUI visible progress comes later; requires discipline not to overbuild hooks before packaging.

#### Option B — GUI-first rewrite on React Flow

Start with Phase G, then wire Factory later.

- Pros: visible product quickly; user-facing demo improves fast.
- Cons: high risk of GUI becoming a second state model; violates PRD “harness-first, GUI-second”; delays Claude-native maker proof.

#### Option C — New `harness.yaml` IR / substrate replacement

Introduce a new canonical IR and recompile everything from it.

- Pros: superficially matches older proposal/seed language.
- Cons: directly violates current user direction; duplicates canonical project model; risks breaking stable substrate and tests.

#### Option D — Team-parallel all phases immediately

Run D-J concurrently.

- Pros: fastest wall-clock if coordination works.
- Cons: shared-file conflicts around `src/web/server.ts`, package.json, tests, docs; high integration risk before D/E/F contracts are stable.

### Chosen option

Choose **Option A** as the canonical execution plan. Use Ralph for sequential implementation or Team only with strict lane ownership once the phase boundaries below are accepted.

### Rejected alternatives

- Reject Option B because the GUI would likely create an accidental second project/session model before Factory actions are real.
- Reject Option C because canonical project files are already working and explicitly locked as source of truth.
- Reject Option D as a default because Phases D/E/F define contracts that GUI/debugger/runtime workers depend on; use Team only with a staged integration policy.

### Pressure-test memo (applied before finalizing)

- **Blind spot 1 — product entrypoint mismatch:** Current repo is `oh-my-openharness`, while PRD/golden path says `harness-editor`. The plan now assigns alias/bin compatibility to Phase F/J and guards it with `tests/bin-entry.test.ts`.
- **Blind spot 2 — synthetic sandbox overclaim:** Current sandbox replays generated scripts, but the PRD wants live host behavior. The plan now requires a real isolated Claude-host proof path for 100% release readiness, while allowing fixture fallback for CI.
- **Blind spot 3 — live transport dependency ambiguity:** The plan now prefers SSE/WebSocket-equivalent no-dependency streaming first and requires an ADR if strict WebSocket semantics need `ws` or a Bun-native server shift.
- **Readiness verdict:** ready for `$ralph --prd` or a staged `$team` execution handoff.

### ADR — Harness Editor 100% completion strategy

- **Decision:** Complete Harness Editor through additive, runtime-first phases D-J, preserving canonical project truth and using React/React Flow only for the GUI layer.
- **Drivers:** substrate stability, PRD golden path, testable phase boundaries, no-code promise, isolated live proof.
- **Alternatives considered:** GUI-first rewrite; new YAML IR; immediate all-phase parallel team execution; keep inline SVG editor permanently.
- **Why chosen:** Runtime hooks, orchestration, and Claude-native packaging are the product engine. Once they are real, the GUI can be a faithful view/editor instead of a parallel model.
- **Consequences:** Early execution will feel backend-heavy, but each commit will unlock a later user-facing surface. Package/dependency changes are deferred until Phase G.
- **Follow-ups:** Write D/F hook fixtures before runtime scripts; add a Phase G dependency ADR before `bun add`; require golden path proof before release readiness.

### Pre-mortem — 3 failure scenarios

1. **Factory state diverges from canonical project files.**
   - Cause: hooks/GUI write session state without materializing or reloading canonical project.
   - Mitigation: every build/preview/verify/export state transition records `projectPath`, graph hash, and canonical reload proof; tests assert project files remain source of truth.
2. **React Flow GUI ships but cannot prove runtime behavior.**
   - Cause: canvas edits work, but trace/debug streaming remains mock/static.
   - Mitigation: Phase G cannot claim PRD completion; Phase H acceptance requires real sandbox trace stream, stale detection, failure localization, and hot reload/re-run proof.
3. **Claude package installs but breaks existing substrate commands.**
   - Cause: setup/runtime-setup changes write too broadly or top-level CLI gets coupled to Factory.
   - Mitigation: substrate regression suite runs every phase; no non-factory reverse imports unless explicitly planned; setup/doctor changes are guarded by dry-run and temp-home tests.

## 5. Dependency decision for GUI

### Decision

Use **React + React DOM + `@xyflow/react` + Vite React TypeScript build** for Phase G.

### Evidence from official docs

- React Flow quick start documents `@xyflow/react`, rendering `<ReactFlow />`, importing `@xyflow/react/dist/style.css`, and using Vite/Bun setup commands: https://reactflow.dev/learn
- Vite docs list `react-ts` as a supported template, document Bun creation/install commands, and describe Vite as a fast dev server/build command with typed plugin APIs: https://vite.dev/guide/

### Planned dependency set

- Runtime dependencies: `react`, `react-dom`, `@xyflow/react`
- Dev dependencies: `vite`, `@vitejs/plugin-react`, `@types/react`, `@types/react-dom`
- Existing dev dependencies remain: `typescript`, `bun-types`

### Rejected GUI options

- **Keep inline SVG viewer only:** rejected because drag/drop/ports/selection/fit/edge interactions and accessibility would need to be rebuilt manually.
- **Canvas/SVG custom editor from scratch:** rejected because it burns product time on graph primitives instead of harness semantics.
- **Non-React graph framework:** rejected because PRD and seed already lock React/React Flow direction and React Flow has direct node/edge primitives aligned with canonical graph mapping.

## 6. Phase execution plan

### Phase D — Runtime hook routing

**Goal:** Turn the pure `routeFactoryPrompt` seam into host-executable hook scripts for Factory conversational flow.

**Implementation scope**
- Add hook runtime modules for `SessionStart`, `UserPromptSubmit`, `PreToolUse`, and `PostToolUse`.
- Define stdin/stdout contracts and fixtures for Claude-style hook execution.
- Load/save Factory state through `createHarnessFactoryStore`.
- Route prompts to ask/draft/build/preview/verify/export without executing unsafe actions in hook-only tests.
- PreToolUse blocks or warns on out-of-order project mutations when Factory is not ready.
- PostToolUse updates state after recognized materialization/project mutation events.

**Likely files touched**
- `src/factory/hooks/index.ts`
- `src/factory/hooks/runtime.ts` (new)
- `src/factory/hooks/session-start.ts` (new)
- `src/factory/hooks/user-prompt-submit.ts` (new)
- `src/factory/hooks/pre-tool-use.ts` (new)
- `src/factory/hooks/post-tool-use.ts` (new)
- `src/factory/hooks/io.ts` (new)
- `tests/factory-hooks.test.ts` (new)
- `tests/fixtures/factory-hooks/*.json` (new)

**Acceptance criteria**
- Each hook can be invoked with a fixture stdin payload and returns deterministic host-valid JSON/stdout.
- `SessionStart` emits current Factory state and next recommended action.
- `UserPromptSubmit` routes to `ask-question`, `draft`, `build`, `preview`, `verify`, or `export` using current state.
- `PreToolUse` rejects or warns about out-of-order writes before target runtime/capabilities are sufficient.
- `PostToolUse` persists recognized project path/state updates.
- Hook tests prove state is saved/loaded from disk and no canonical project replacement occurs.

**Tests**
- Unit: route normalization, stdin parsing, stdout shape, invalid payload handling.
- Integration: fixture-driven hook invocation with temp Factory store.
- Regression: existing `tests/factory-interview.test.ts` and `tests/factory-integration.test.ts` stay green.

**Verification commands**
- `bun test tests/factory-hooks.test.ts tests/factory-interview.test.ts tests/factory-integration.test.ts`
- `bunx tsc --noEmit`
- `bun run test`

**Commit boundary**
- Commit after hook fixture tests and all existing tests pass.
- Lore intent: `Route Factory conversations through executable runtime hooks`.

**Rollback risk**
- Narrow/moderate. New files mostly under `src/factory/hooks/`; rollback should not affect substrate if no top-level setup wiring is included.

**Likely blockers**
- Host-specific hook stdout contracts may need adjustment once real Claude install proof starts in Phase F.

### Phase E — Factory action orchestration

**Goal:** Provide one stateful orchestration layer for draft/build/preview/verify/export actions using existing substrate adapters.

**Implementation scope**
- Add action orchestrator that accepts a Factory state + route/action request.
- Implement `draft`, `build`, `preview`, `verify`, `export` commands over existing adapters.
- Capture failure state with action, message, stack/category, timestamp, project path, graph hash if available.
- Persist project path, preview URL, verification summary, export paths, and last action status.
- Ensure actions never write a second IR; materialization goes through `writeHarnessProject`.

**Likely files touched**
- `src/factory/actions/index.ts`
- `src/factory/actions/substrate.ts`
- `src/factory/actions/orchestrator.ts` (new)
- `src/factory/actions/errors.ts` (new)
- `src/factory/state/schema.ts`
- `src/factory/state/store.ts`
- `tests/factory-actions.test.ts` (new)
- `tests/factory-integration.test.ts`

**Acceptance criteria**
- `draft` produces a deterministic draft summary/spec from Factory state without writing a project.
- `build` materializes a canonical project and stores `projectPath` plus graph hash metadata.
- `preview` opens the existing server and stores URL/token/status without requiring GUI dependency.
- `verify` runs `validateProject` and persists pass/fail trace summary.
- `export` calls `exportProjectBundle` and records bundle path/runtime.
- Action failures are persisted and returned in a testable shape.

**Tests**
- Unit: action routing and state patching.
- Integration: temp dir state → build → compile/verify/export using existing substrate.
- Failure: invalid project path and forced sandbox failure capture.

**Verification commands**
- `bun test tests/factory-actions.test.ts tests/factory-integration.test.ts tests/sandbox.test.ts tests/compiler.test.ts`
- `bunx tsc --noEmit`
- `bun run test`

**Commit boundary**
- Commit after action orchestrator and failure-state tests pass.
- Lore intent: `Make Factory actions stateful over the substrate`.

**Rollback risk**
- Moderate. Touches state schema; provide migration/default handling for older state files.

**Likely blockers**
- Long-lived preview server handles are hard to persist across hook invocations; state should persist URL/status, not raw handles.

### Phase F — Claude-native Harness Maker package

**Goal:** Generate/install a Claude Code-native harness-maker package that exposes Factory skills/hooks/manifests and proves install shape.

**Implementation scope**
- Generate Claude plugin package for the harness-maker itself.
- Add or plan the `harness-editor` package/bin alias while preserving the existing `oh-my-openharness` substrate bin compatibility.
- Include skills: `harness-factory`, `harness-interview`, `harness-synthesize`, `harness-build`, `harness-preview`, `harness-verify`, `harness-reference-search`.
- Include executable hook scripts from Phase D.
- Generate `plugin.json`, hooks config, state directory contract, and setup metadata.
- Integrate with `setup` / `doctor` through existing `src/core/runtime-setup.ts` without breaking current runtime setup behavior.
- Prove install in temp Claude config/install root; optionally add manual real-host proof artifact after automated temp proof.

**Likely files touched**
- `src/factory/package/claude.ts` (new)
- `src/factory/package/templates/claude/**` (new)
- `src/factory/hooks/**`
- `src/core/runtime-setup.ts`
- `src/index.ts` only if CLI surface needs a new explicit subcommand, setup flag, or `harness-editor` alias routing
- `package.json` / bin metadata for `harness-editor` compatibility alias if implemented in this phase
- `bin/harness-editor` or equivalent package entrypoint if implemented in this phase
- `tests/factory-claude-package.test.ts` (new)
- `tests/runtime-setup.test.ts`
- `tests/cli.test.ts`
- `tests/bin-entry.test.ts`

**Acceptance criteria**
- Generated package contains `plugin.json`, skills, hook scripts, and manifest references with no missing paths.
- Hook scripts are executable in temp install shape with fixture stdin.
- `setup --runtimes claude --dry-run --json` reports harness-maker install plan without writes.
- `doctor --runtimes claude --json` can distinguish configured/scaffolded/missing host states.
- Existing setup/doctor tests still pass.
- A repo-local `harness-editor` entrypoint or documented alias path invokes the same stable substrate without breaking `oh-my-openharness`.

**Tests**
- Unit: package manifest shape and path references.
- Integration: temp-home setup apply/dry-run/doctor.
- Fixture: generated hook script invocation.
- Regression: existing CLI setup/doctor/export/import suite.

**Verification commands**
- `bun test tests/factory-claude-package.test.ts tests/runtime-setup.test.ts tests/cli.test.ts tests/factory-hooks.test.ts`
- `bunx tsc --noEmit`
- `bun run test`

**Commit boundary**
- Commit after install proof and setup/doctor regression pass.
- Lore intent: `Package the Factory as a Claude-native harness maker`.

**Rollback risk**
- Moderate/high because setup/doctor touches user-facing install surfaces. Keep dry-run and temp roots first.

**Likely blockers**
- Exact Claude plugin hook path conventions may need a small compatibility adjustment during real-host proof.

### Phase G — GUI foundation

**Goal:** Replace/augment the inline SVG viewer with the PRD GUI foundation while preserving current server/API contracts.

**Implementation scope**
- Add React/Vite client under `src/web/client/`.
- Map canonical `GraphNode`/`GraphEdge`/`LayoutNode` to React Flow nodes/edges.
- Implement panels: catalog, canvas, inspector, Factory state panel, chat/interview panel.
- Add server endpoints for catalog, Factory state, chat/interview actions, skill editing, and compatibility metadata.
- Keep existing inline viewer as fallback until Vite build/static serving is proven, or replace in one commit only if tests cover parity.
- Add dependency ADR in commit body before installing dependencies.

**Likely files touched**
- `package.json`, `bun.lockb` or lockfile equivalent after dependency install
- `tsconfig.json`
- `vite.config.ts` (new)
- `index.html` or `src/web/client/index.html` (new, depending Vite root)
- `src/web/client/main.tsx` (new)
- `src/web/client/App.tsx` (new)
- `src/web/client/components/*` (new)
- `src/web/client/api.ts` (new)
- `src/web/client/types.ts` (new)
- `src/web/server.ts`
- `src/web/viewer.ts` only for fallback or removal
- `tests/server.test.ts`
- `tests/gui-shell-contract.test.ts`
- `tests/gui-client-build.test.ts` (new)

**Acceptance criteria**
- GUI loads canonical project through `/api/project` and renders nodes/edges in React Flow.
- Catalog lists atomic blocks and composite patterns from the authoritative registry.
- Inspector edits node label/config and Skill markdown/frontmatter through server APIs.
- Factory state panel shows stage, target runtime, open questions, confirmed decisions, project/preview/verification status.
- Chat/interview panel can submit user text to Factory route/action endpoints and display next question/action result.
- Runtime compatibility indicators appear per node and are derived from registry/runtime metadata.
- Layout changes update only `layout.json`; semantic graph files remain unchanged.

**Tests**
- Unit-ish: graph mapping helpers and API client payload transforms.
- Integration: server static client route and new API endpoints.
- Build: `bunx vite build` or script equivalent.
- Regression: current server auth/mutation/layout/stale trace tests remain green.

**Verification commands**
- `bun install` only during this future phase, not in planning session.
- `bunx vite build` or `bun run build:web` after script addition.
- `bun test tests/gui-client-build.test.ts tests/server.test.ts tests/gui-shell-contract.test.ts`
- `bunx tsc --noEmit`
- `bun run test`

**Commit boundary**
- Commit after dependency install, client build, server API tests, and full suite pass.
- Lore intent: `Move the editor shell onto React Flow without changing project truth`.

**Rollback risk**
- High. First phase with new dependencies and many UI files. Keep fallback viewer until client build/static serving is proven.

**Likely blockers**
- TS config JSX settings, Bun/Vite build output serving, and skill editor form design.

### Phase H — Live sandbox debugger

**Goal:** Make runtime trace/debugging live, faithful, and actionable from the GUI.

**Implementation scope**
- Add trace stream endpoint using SSE or WebSocket-equivalent live transport; prefer no new dependency first, but record an ADR if strict WebSocket semantics require `ws` or a Bun-native server shift.
- Add an isolated real Claude-host sandbox proof path for release readiness when the host CLI is installed/authenticated; automated CI may keep fixture-based fallback, but 100% release proof must not rely only on mock scripts.
- Connect sandbox execution to streaming trace reads.
- Highlight nodes/edges as events arrive.
- Display failures with hook, node, event type, message, metadata, and likely action.
- Detect stale traces with graph hash mismatch.
- Add hot reload/re-run seam: after graph edit, rerun affected validation or restart sandbox cleanly if true hot reload is not safe.

**Likely files touched**
- `src/web/server.ts`
- `src/web/client/components/TracePanel.tsx` (new or updated)
- `src/web/client/components/Canvas.tsx`
- `src/sandbox/validate.ts`
- `src/compiler/runtime-common.ts`
- `src/core/types.ts` if trace metadata needs extension
- `tests/live-debugger.test.ts` (new)
- `tests/runtime-validation.test.ts`
- `tests/sandbox.test.ts`
- `tests/server.test.ts`

**Acceptance criteria**
- GUI receives trace updates without manual refresh while sandbox runs.
- Hook activation, branch selection, state transition, loop iteration, custom block, failure, and MCP events can all highlight graph nodes when present.
- Failure event selects/highlights the failing node and renders details safely escaped.
- Stale trace warning appears when graph hash differs.
- Hot reload/re-run seam is documented and tested; if true hot reload is infeasible, the product performs a safe bounded rerun and labels it honestly.
- Release proof includes either a real isolated Claude host sandbox run or an explicit blocker stating the host proof is unavailable; V1 100% cannot be claimed from synthetic hook replay alone.

**Tests**
- Unit: trace reducer/event-to-highlight mapping.
- Integration: server stream emits appended trace events to a test client.
- Sandbox: forced failure surfaces correctly through stream and `/api/trace`.
- Regression: XSS escaping and stale trace tests remain green.

**Verification commands**
- `bun test tests/live-debugger.test.ts tests/sandbox.test.ts tests/runtime-validation.test.ts tests/server.test.ts tests/gui-shell-contract.test.ts`
- `bunx tsc --noEmit`
- `bun run test`

**Commit boundary**
- Commit after live trace stream and failure localization proof pass.
- Lore intent: `Stream sandbox behavior into the graph debugger`.

**Rollback risk**
- Moderate/high. Streaming and sandbox process boundaries can be flaky; isolate behind endpoints and keep `/api/trace` polling fallback.

**Likely blockers**
- True no-restart hot reload may not be safe for host runtime state; acceptance allows honest rerun seam if documented.

### Phase I — Multi-runtime polish

**Goal:** Make Claude/OpenCode/Codex support honest, compatible, and roundtrip-tested.

**Implementation scope**
- Add runtime compatibility metadata to registry/project/action responses.
- Harden Claude export/install proof.
- Harden OpenCode/Codex export shape, validation manifests, and setup/doctor messages.
- Add import/export roundtrip tests for all supported runtimes.
- Ensure unsupported runtime-specific features are blocked or warned before export.

**Likely files touched**
- `src/core/types.ts`
- `src/core/registry.ts`
- `src/core/runtime-targets.ts`
- `src/core/runtime-setup.ts`
- `src/compiler/claude.ts`
- `src/compiler/opencode.ts`
- `src/compiler/codex.ts`
- `src/compiler/runtime-common.ts`
- `src/core/import-seed.ts`
- `src/factory/actions/orchestrator.ts`
- `tests/compiler.test.ts`
- `tests/cli.test.ts`
- `tests/bin-entry.test.ts`
- `tests/runtime-setup.test.ts`
- `tests/import-seed-security.test.ts`
- `tests/multi-runtime-roundtrip.test.ts` (new)

**Acceptance criteria**
- Each node/block exposes compatibility for Claude/OpenCode/Codex.
- Export refuses or clearly warns on runtime-incompatible graph nodes.
- Claude package install proof passes.
- OpenCode and Codex bundles compile, validate shape, and roundtrip through import seed.
- Runtime compatibility metadata appears in API responses and GUI.

**Tests**
- Unit: compatibility matrix and warnings.
- Integration: compile/export/import for all runtimes.
- Regression: existing compiler/import/setup/doctor tests.

**Verification commands**
- `bun test tests/compiler.test.ts tests/cli.test.ts tests/runtime-setup.test.ts tests/multi-runtime-roundtrip.test.ts tests/import-seed-security.test.ts`
- `bunx tsc --noEmit`
- `bun run test`

**Commit boundary**
- Commit after all runtime roundtrips pass.
- Lore intent: `Make runtime support explicit and roundtrip-verified`.

**Rollback risk**
- Moderate. Compiler changes can affect export/import fixtures across runtimes.

**Likely blockers**
- OpenCode/Codex host-specific install proof may remain scaffold-level unless real hosts are available; document support level honestly.

### Phase J — Docs and release readiness

**Goal:** Align docs, examples, proof artifacts, and release checklist with actual V1 behavior.

**Implementation scope**
- Update README and Korean usage guide for Harness Editor flow and substrate compatibility.
- Add architecture guide documenting canonical project, Factory, hooks, GUI, sandbox/debugger, runtime backends.
- Add troubleshooting guide for setup, mutation token, hook failures, stale traces, dependency/build issues.
- Add example harness and golden path documentation.
- Add release checklist and proof index.

**Likely files touched**
- `README.md`
- `docs/usage-ko.md`
- `docs/harness-editor-architecture.md` (new)
- `docs/harness-editor-troubleshooting.md` (new)
- `docs/harness-editor-golden-path.md` (new)
- `examples/harness-maker-demo/` (new) or `.omx/proofs/harness-editor-golden-path/` proof artifacts
- `.omx/plans/` plan/test-spec updates only if execution discovers changed scope

**Acceptance criteria**
- Docs describe actual commands, not aspirational commands.
- Korean guide includes install → chat/build → GUI → verify/export → troubleshooting.
- Architecture guide states canonical project is source of truth and Factory/GUI are layers.
- Golden path doc links exact proof artifacts and commands.
- Release checklist includes final `bunx tsc --noEmit`, `bun run test`, golden path proof, and clean git status.

**Tests**
- Documentation review: command snippets are executable or explicitly marked manual.
- Optional script: grep docs for forbidden source-of-truth language such as canonical `harness.yaml`.
- Regression: full test suite.

**Verification commands**
- `bunx tsc --noEmit`
- `bun run test`
- Golden path proof command/script from the final test spec
- `git status --short`

**Commit boundary**
- Commit after docs and final proof index are complete.
- Lore intent: `Document the verified Harness Editor V1 path`.

**Rollback risk**
- Low/moderate. Docs can be reverted independently unless examples/proofs are generated.

**Likely blockers**
- Final golden path may reveal mismatch between intended and actual CLI name (`harness-editor` vs `oh-my-openharness`); implement or document the alias before release docs and keep old substrate bin compatibility.

## 7. Regression guard for existing substrate commands

Every phase must preserve these checks:

1. CLI help advertises and routes: `setup`, `doctor`, `chat`, `author`, `new`, `import`, `compile`, `export`, `sandbox`, `serve`, `catalog`, `demo`.
2. Existing tests remain green:
   - `tests/cli.test.ts`
- `tests/bin-entry.test.ts`
   - `tests/compiler.test.ts`
   - `tests/sandbox.test.ts`
   - `tests/server.test.ts`
   - `tests/runtime-setup.test.ts`
   - `tests/import-seed-security.test.ts`
3. Non-factory reverse import guard remains unless a later phase explicitly updates the boundary test and docs.
4. `writeHarnessProject`/`loadHarnessProject` remain the only canonical project persistence path.
5. `serve` mutation protection stays token + same-origin.
6. `sandbox` remains isolated through temp HOME/XDG/runtime config dirs.

## 8. Expanded test plan

### Unit
- Hook stdin/stdout parsing and route decisions.
- Factory state schema/store migrations/defaults.
- Action orchestrator state transitions and failure capture.
- GUI graph mapping and trace highlight reducer.
- Compatibility matrix and export warning logic.

### Integration
- Factory state → hook route → action → canonical project materialization.
- Build → preview → verify → export with persisted state updates.
- Claude package generation → temp install shape → hook fixture execution.
- Server APIs for catalog, Factory state, chat, inspector skill edit, trace stream.
- Import/export roundtrip for Claude/OpenCode/Codex bundles.

### E2E / golden path
- Fresh temp workspace.
- Run product command/entrypoint.
- Create or open Factory session.
- Answer interview questions.
- Build canonical project.
- Open GUI and validate catalog/canvas/chat/inspector.
- Add composite + edit skill + add loop/routing via chat.
- Export to Claude.
- Run isolated sandbox and stream trace into GUI.
- Force one hook failure and verify GUI failure localization.
- Edit graph and hot reload/re-run.
- Export/roundtrip OpenCode and Codex support-level proof.
- Harness-maker creates another harness project.

### Observability
- Trace schema covers hook activation, branch selection, state transition, loop iteration, custom block, failure, MCP server.
- Events include graph hash, runtime, hook, node ID, message, timestamp, status.
- GUI shows stale trace on graph hash mismatch.
- Failure state is stored in Factory state and visible in GUI.

### Regression
- Existing substrate command suite.
- Security: path traversal/symlink guards, mutation token, same-origin, import seed path containment.
- No-source-of-truth-drift check: docs/tests forbid new canonical `harness.yaml` language.
- No broad dependency drift: `package.json` additions limited to Phase G dependency ADR unless explicitly approved.

## 9. Ralph vs Team execution guidance

### Ralph is appropriate for

- Phase D alone.
- Phase E alone.
- Phase F after Phase D/E are green.
- Phase I polish when runtime surfaces are small and sequential.
- Phase J docs/release closeout.

Ralph should run phases sequentially and commit after each phase. It is the safest default because D/E/F define contracts later phases depend on.

### Team is appropriate for

Use Team only after D/E/F contracts are stable or if running a tightly coordinated implementation with strict ownership.

Recommended lanes for a 5-worker team:

1. Runtime hooks + Claude package lane: Phases D/F shared hook/package surfaces.
2. Action/runtime lane: Phase E plus Phase I compatibility/export/roundtrip.
3. GUI lane: Phase G React/React Flow client and server endpoints.
4. Sandbox/debugger lane: Phase H trace stream, failure localization, hot reload/re-run seam.
5. Verification/docs lane: cross-phase tests, substrate regression, golden path proof, docs/release readiness.

Shared-file conflict policy:
- `src/web/server.ts`, `package.json`, `tsconfig.json`, and `tests/` require leader-mediated edits.
- Workers must not rewrite each other’s files or revert changes.
- Verification worker owns final evidence, not feature implementation.

## 10. Copy/paste Ralph prompt

```text
$ralph --prd
Start cwd: /Users/cosmos/Documents/harness

Task: Execute the approved Harness Editor 100% master plan. Do not broad replan.

Baseline:
- Current baseline commit: 356ae9cb8355bc7e19da89e91cd72d5a36e27569 (356ae9c Complete the Factory interview path into substrate handoff)
- Baseline expected verification from planning session: bunx tsc --noEmit green; bun run test green with 101 pass / 0 fail
- Start by verifying git status --short is clean or only contains planning docs from the prior session.

Must read first:
1. AGENTS.md
2. README.md
3. docs/usage-ko.md
4. docs/harness-factory-plan.md
5. docs/harness-factory-phase-a-b-review.md
6. HARNESS_EDITOR_PROPOSAL.md
7. HARNESS_EDITOR_PRD.md
8. seed_harness_editor.yaml
9. .omx/plans/harness-editor-100-percent-master-plan.md
10. .omx/plans/harness-editor-100-percent-test-spec.md

Execution order:
D. Runtime hook routing
E. Factory action orchestration
F. Claude-native Harness Maker package
G. GUI foundation
H. Live sandbox debugger
I. Multi-runtime polish
J. Docs/release readiness

Binding constraints:
- No substrate replacement.
- No new IR/source of truth. Canonical project files remain source of truth.
- Factory stays additive under src/factory/ and calls existing substrate adapters.
- Existing CLI commands must not regress: setup, doctor, chat, author, new, import, compile, export, sandbox, serve, catalog, demo.
- Do not install new dependencies except the Phase G GUI dependency set: react, react-dom, @xyflow/react, vite, @vitejs/plugin-react, @types/react, @types/react-dom. Add a dependency ADR in the Phase G commit message.
- Do not read reference harness repos unless needed for a concrete pattern/compatibility question.
- Commit once per phase using Lore commit protocol. Do not batch phases.

Per-phase acceptance criteria are the criteria in .omx/plans/harness-editor-100-percent-master-plan.md Section 6 and test details in .omx/plans/harness-editor-100-percent-test-spec.md.

Minimum final verification:
- bunx tsc --noEmit
- bun run test
- Golden Path proof from the test spec: product entrypoint -> Factory interview/build -> GUI canvas/catalog/chat/inspector -> Claude export -> isolated sandbox trace/failure proof -> graph edit hot reload/re-run -> multi-runtime export/import roundtrip support proof -> harness-maker creates another harness project
- git status --short clean after final Lore commit

Report after each phase:
- files changed
- acceptance criteria satisfied
- tests run and exact pass/fail evidence
- rollback risk/blockers
```

## 11. Copy/paste Team prompt

```text
$team 5:executor "Harness Editor 100% execution from approved master plan"

Start cwd: /Users/cosmos/Documents/harness

Mission: Execute .omx/plans/harness-editor-100-percent-master-plan.md and .omx/plans/harness-editor-100-percent-test-spec.md without broad replanning, preserving the existing OMOH substrate and canonical project source of truth.

Recommended workers: 5

Worker allocation:
1. worker-1 Runtime Hooks + Claude Package
   - Own: src/factory/hooks/**, src/factory/package/**, generated Claude hook/skill templates, hook fixtures/tests.
   - Phases: D and F.
2. worker-2 Factory Actions + Runtime Compatibility
   - Own: src/factory/actions/**, state updates related to action results, compiler/runtime compatibility tests, import/export roundtrip tests.
   - Phases: E and I.
3. worker-3 GUI Foundation
   - Own: src/web/client/**, Vite config, React Flow graph mapping, catalog/canvas/inspector/Factory/chat panels.
   - Phase: G.
4. worker-4 Live Sandbox Debugger
   - Own: trace stream endpoint/client integration, sandbox trace/failure/stale/hot reload seam tests.
   - Phase: H.
5. worker-5 Verification + Docs
   - Own: cross-phase test plan, substrate regression evidence, golden path proof, README/docs/usage-ko/architecture/troubleshooting/golden-path docs.
   - Phase: J plus continuous verification lane.

Shared file conflict policy:
- package.json, lockfile, tsconfig.json, src/web/server.ts, src/core/types.ts, src/core/runtime-setup.ts, src/index.ts, and tests/* are shared files. Workers must announce intended edits and coordinate through leader before modifying.
- No worker may revert another worker’s changes.
- Canonical project files remain source of truth; no new harness.yaml canonical IR.
- Dependency policy: only worker-3 may add the Phase G GUI dependencies, and only with leader approval inside the plan scope.

Verification lane:
- worker-5 keeps a running checklist against .omx/plans/harness-editor-100-percent-test-spec.md.
- Every worker must run targeted tests for owned files before reporting done.
- Leader/verification lane runs bunx tsc --noEmit, bun run test, and golden path proof before shutdown.

Shutdown criteria:
- All phases D-J acceptance criteria pass.
- bunx tsc --noEmit passes.
- bun run test passes.
- Golden Path proof exists and is linked from docs.
- Substrate command regression guard passes.
- Final git status --short is clean after Lore commits.
"
```
