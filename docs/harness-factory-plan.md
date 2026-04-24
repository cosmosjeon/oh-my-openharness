# Harness Factory One-Shot Build Plan

## Goal

Turn OMOH from a “harness project toolchain” into a **harness-authoring product**:

1. install OMOH into Claude
2. user opens Claude in a workspace
3. user says what kind of harness they want
4. OMOH asks focused follow-up questions
5. OMOH synthesizes a draft harness from reference patterns + user answers
6. OMOH materializes a canonical project on disk
7. user keeps refining the harness through chat and optional browser graph editing
8. OMOH verifies / exports / previews the result

The key shift is:

> current OMOH = execution substrate  
> target OMOH = **Harness Factory** built on that substrate

---

## Product boundary

### What stays
- canonical project model (`src/core/project.ts`, `src/core/types.ts`)
- graph generation / refresh (`src/core/generator.ts`)
- runtime setup + bridge install (`src/core/runtime-setup.ts`)
- browser editor + trace viewer (`src/web/server.ts`, `src/web/viewer.ts`)
- compile / export / import / sandbox pipeline (`src/compiler/*`, `src/core/import-seed.ts`, `src/sandbox/validate.ts`)

### What gets added
- harness-factory interview engine
- harness-factory session state
- reference-pattern extraction/catalog
- Claude hook routing for interview / synthesis / apply / verify
- conversation-driven graph-delta builder
- “show me the draft / refine it / open editor / verify it” workflow

### What must not break
- `new`, `author`, `serve`, `sandbox`, `export`, `import` continue to work as low-level primitives
- current canonical project structure stays the single source of truth
- browser editor remains an optional refinement layer, not the only authoring path

---

## Reuse map from cloned reference harnesses

### 1. Interview / ambiguity / brownfield discovery
Source:
- `ouroboros/src/ouroboros/bigbang/interview.py`
- `ouroboros/src/ouroboros/bigbang/pm_interview.py`
- `ouroboros/src/ouroboros/bigbang/ambiguity.py`
- `ouroboros/src/ouroboros/bigbang/question_classifier.py`
- `ouroboros/src/ouroboros/bigbang/brownfield.py`

Use:
- classify user intent
- compute what must be asked next
- gate build until enough signal exists
- distinguish greenfield harness from “make me one like OMC/OMO”

### 2. Hook / prompt-injection lifecycle
Source:
- `oh-my-openagent/src/hooks/claude-code-hooks/*`
- especially `user-prompt-submit.ts`, `pre-tool-use.ts`, `post-tool-use.ts`, `session-*`

Use:
- `SessionStart`: inject current harness-factory state + next recommended action
- `UserPromptSubmit`: decide whether to ask, summarize, build, revise, preview, or verify
- `PreToolUse`: block unsafe or out-of-order writes
- `PostToolUse`: update state after graph/project mutations

### 3. Workflow state / checkpointing
Source:
- `ouroboros/src/ouroboros/orchestrator/workflow_state.py`
- `ouroboros/src/ouroboros/persistence/checkpoint.py`
- `ouroboros/src/ouroboros/persistence/event_store.py`

Use:
- persistent draft state
- open questions
- confirmed decisions
- last built project path
- last preview / verification state

### 4. Skill routing and multi-skill packaging
Source:
- `oh-my-codex` prompts / skills / routing
- `superpowers/skills/*`
- `gstack/*`

Use:
- compose a dedicated skill pack instead of a single weak bridge prompt
- split interview, synthesis, build, preview, verify into explicit skills
- route by session stage instead of asking the user to memorize commands

### 5. Pattern extraction from real harness repos
Source:
- `oh-my-claudecode`
- `oh-my-openagent`
- `oh-my-codex`
- `ouroboros`
- `superpowers`
- `gstack`

Use:
- turn “approval gate”, “review loop”, “MCP registration”, “memory persistence”, “retry loop”, “subagent delegation”, “hook sequencing” into reusable pattern records

---

## Target architecture

## Layer 0 — OMOH execution substrate (existing)
- `src/core/project.ts`
- `src/core/types.ts`
- `src/core/generator.ts`
- `src/core/host-authoring.ts`
- `src/compiler/*`
- `src/web/*`
- `src/sandbox/validate.ts`

These remain the engine.

## Layer 1 — Harness Factory domain
New:
- `src/factory/state/schema.ts`
- `src/factory/state/store.ts`
- `src/factory/interview/question-types.ts`
- `src/factory/interview/interview-engine.ts`
- `src/factory/interview/ambiguity.ts`
- `src/factory/interview/summary.ts`

Responsibility:
- represent “what the user wants”
- represent “what we still need to ask”
- represent the current draft harness spec

## Layer 2 — Reference pattern system
New:
- `src/factory/reference/catalog.ts`
- `src/factory/reference/extractors/*`
- `src/factory/reference/search.ts`
- `src/factory/reference/pattern-registry.json`

Responsibility:
- expose reusable patterns from the cloned repos in a structured way
- answer: “what existing harness pattern best matches this requested capability?”

## Layer 3 — Synthesis / build planning
New:
- `src/factory/synthesis/draft-spec.ts`
- `src/factory/synthesis/graph-plan.ts`
- `src/factory/synthesis/capability-mapping.ts`
- `src/factory/builder/apply-draft.ts`

Responsibility:
- turn user decisions + reference patterns into graph deltas
- map high-level intent into current canonical project model

## Layer 4 — Claude harness-factory runtime
New:
- `src/factory/hooks/session-start.ts`
- `src/factory/hooks/user-prompt-submit.ts`
- `src/factory/hooks/pre-tool-use.ts`
- `src/factory/hooks/post-tool-use.ts`
- `src/factory/skills/harness-factory/*`

Responsibility:
- make the product feel like a real Claude-native harness-building assistant

## Layer 5 — Preview / verify orchestration
New:
- `src/factory/actions/show-draft.ts`
- `src/factory/actions/open-editor.ts`
- `src/factory/actions/run-verification.ts`
- `src/factory/actions/export-runtime.ts`

Responsibility:
- let the conversation trigger the existing `serve`, `sandbox`, `export`, `import` substrate safely

---

## Proposed skill pack

Install these into the Claude bridge:

1. `harness-factory`
   - top-level orchestrator skill
2. `harness-interview`
   - asks next best question
3. `harness-synthesize`
   - summarizes current understanding and draft
4. `harness-build`
   - materializes or updates canonical project
5. `harness-preview`
   - opens browser/editor and explains what to look at
6. `harness-verify`
   - runs sandbox/export/import validation and summarizes results
7. `harness-reference-search`
   - pulls in patterns from the cloned repos

The user should not need to remember these names; routing should pick them automatically.

---

## State schema

Minimum persistent state:

```ts
interface HarnessFactoryState {
  sessionId: string;
  stage: "intake" | "interview" | "drafting" | "built" | "previewing" | "verifying";
  userIntent: string;
  targetRuntime?: "claude-code" | "opencode" | "codex";
  requestedCapabilities: string[];
  confirmedDecisions: Array<{ key: string; value: unknown; source: "user" | "reference" | "derived" }>;
  openQuestions: Array<{ id: string; question: string; reason: string; priority: number }>;
  referencePatterns: Array<{ id: string; sourceRepo: string; why: string }>;
  draftGraphSpec: {
    nodes: Array<Record<string, unknown>>;
    edges: Array<Record<string, unknown>>;
    runtimeIntents: Array<Record<string, unknown>>;
    skills: Array<Record<string, unknown>>;
  };
  projectPath?: string;
  preview?: { url?: string; lastOpenedAt?: string };
  verification?: { lastRunAt?: string; ok?: boolean; summary?: string };
}
```

---

## User flow we are building

### Desired happy path

1. user installs OMOH to Claude
2. user opens Claude in an empty or chosen workspace
3. user says:
   - “I want a harness like OMC but lighter”
   - or “I need approvals + MCP + memory”
4. OMOH asks **one focused question at a time**
5. after enough answers, OMOH says:
   - “Here’s the draft structure I’m going to build”
6. user says “go ahead”
7. OMOH creates the canonical project
8. user says:
   - “show me”
   - “open the editor”
   - “add a review loop”
   - “make this codex-compatible too”
9. OMOH applies graph deltas and keeps state coherent
10. user says:
   - “verify it”
   - “export it”
11. OMOH runs the existing verification/export substrate

---

## One-shot implementation plan

## Phase A — Stabilize the substrate boundary
Goal: make current OMOH explicitly the engine that the future factory drives.

Tasks:
1. add `factory` namespace/module skeleton under `src/factory/`
2. define the `HarnessFactoryState` schema
3. add a tiny adapter layer from draft graph spec -> current `HarnessProject`
4. ensure `new`, `author`, `serve`, `sandbox`, `export` remain callable as internal actions

Acceptance:
- there is a clear `factory -> current core/compiler/web/sandbox` dependency direction
- no existing CLI command breaks

## Phase B — Reference extraction pass
Goal: stop treating cloned repos as dead snapshots; turn them into pattern sources.

Tasks:
1. create `src/factory/reference/pattern-registry.json`
2. seed first pattern set manually from the cloned repos:
   - approval gate
   - review loop
   - MCP registration
   - memory persistence
   - retry loop
   - subagent delegation
3. write a small extraction/lookup API

Acceptance:
- given a requested capability, the system can return 1-3 relevant reference patterns with source repo provenance


## Current implementation checkpoint — Phase A/B started

The first additive Factory slice now exists in repo shape:

- `src/factory/state/` defines and persists `HarnessFactoryState`.
- `src/factory/reference/` seeds the initial reference pattern registry and search API.
- `src/factory/synthesis/` maps Factory state into the current canonical graph/project model.
- `src/factory/actions/` bridges Factory actions to the existing OMOH substrate for materialize/compile/preview/verify/export/import.
- `src/factory/interview/` and `src/factory/hooks/` are present as explicit future seams.

Phase C now builds on this base with `nextQuestion(state)`, `queueNextQuestion(state)`, `applyAnswer(state, reply)`, `isReadyToDraft(state)`, reference-backed interview question selection, and a pure `routeFactoryPrompt(state, userPrompt)` seam for the future Phase D hook router. The next vertical slice should wire that pure route into runtime hook scripts without changing the substrate boundary.

## Phase C — Interview engine
Goal: create the “discussion before build” core loop.

Tasks:
1. port the ambiguity/question-selection ideas from `ouroboros`
2. implement a `nextQuestion(state)` engine
3. implement `applyAnswer(state, userReply)`
4. define stage transitions:
   - `intake -> interview -> drafting`

Acceptance:
- one user intent produces a sequence of focused questions
- open questions shrink as answers come in
- enough answers lead to a buildable draft state

## Phase D — Claude hook routing
Goal: make the product usable from plain Claude conversation.

Tasks:
1. add `SessionStart` hook injection for current state
2. add `UserPromptSubmit` router:
   - ask next question
   - summarize draft
   - build draft
   - open editor
   - verify/export
3. add `PreToolUse` guard for out-of-order or unsafe mutations
4. add `PostToolUse` state update

Acceptance:
- user can stay inside Claude and move through the interview/build flow without calling raw CLI commands manually

## Phase E — Draft synthesis and build
Goal: convert discussion state into a real canonical harness.

Tasks:
1. map capabilities + reference patterns -> graph draft
2. convert draft -> `HarnessProject`
3. write/update project on disk
4. generate human-readable draft summary before apply

Acceptance:
- user answers a few questions, says “build it”, and gets a working canonical project

## Phase F — Preview and verification integration
Goal: connect the factory flow to the current browser/validation substrate.

Tasks:
1. add “open editor” action that calls current `serve`
2. add “verify it” action that calls current `sandbox`
3. add “export it” action
4. feed results back into conversation state

Acceptance:
- after a build, the user can preview, verify, and export from conversation

## Phase G — First real vertical slice
Goal: prove the product with the exact UX you described.

Acceptance scenario:
1. install OMOH into Claude
2. open Claude in a folder
3. say “I want a harness like OMC but with approvals, MCP, and memory”
4. system asks focused questions
5. user answers
6. system builds draft harness
7. system opens browser graph
8. user asks for one more refinement
9. system updates graph
10. user asks for verification
11. system runs sandbox and reports result

If that works, the product direction is correct.

---

## Recommended implementation order inside this repo

1. `src/factory/state/*`
2. `src/factory/reference/*`
3. `src/factory/interview/*`
4. `src/factory/synthesis/*`
5. `src/factory/actions/*`
6. `src/factory/hooks/*`
7. wire into Claude setup output in `src/core/runtime-setup.ts`
8. only then refine browser/editor integration

---

## Test plan

### Unit
- question selection
- answer application
- capability -> pattern mapping
- draft graph generation

### Integration
- conversation state round-trip
- draft -> canonical project build
- reference pattern retrieval with source provenance
- hook routing by stage

### End-to-end
- Claude install -> conversation -> draft build
- build -> serve
- build -> sandbox
- build -> export

### Manual QA
- does it feel like a “harness architect” instead of a raw CLI?
- are questions focused enough?
- does the user understand the current draft at every stage?

---

## Biggest risks

1. trying to replace the current OMOH substrate instead of building on it
2. importing too much complexity from reference repos without normalizing it
3. making the conversation too interrogative and not enough “buildable”
4. making the browser editor the primary path instead of a refinement layer

---

## Final recommendation

Do **not** treat the next step as “keep polishing OMOH commands.”  
Treat it as:

> **Build a Harness Factory layer on top of the now-stable OMOH engine.**

That is the shortest path to the product you actually want.
