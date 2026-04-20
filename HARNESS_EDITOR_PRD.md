# Harness Editor PRD

Version: 0.1
Status: Draft for development kickoff
Product: harness-editor
License: MIT
Primary runtime for Phase 0: Claude Code

---

## 1. Executive Summary

Harness Editor is a no-code product for building AI coding agent harnesses.

The product exists because generic AI coding agents are not enough for real teams. Every industry needs different approval flows, safety rules, tool permissions, review loops, memory behavior, and runtime constraints. Existing harnesses prove the value of this layer, but they are still authored by developers through markdown, scripts, manifests, and runtime-specific configuration.

Harness Editor turns harness authoring into a graph product with AI assistance, but the center of gravity is not the canvas by itself.

The center of gravity is:

> **intent -> working CLI harness generation**

The first user experience is a CLI-native harness-maker harness. A user chats with AI to create a harness skeleton that already works. After that skeleton exists, the GUI becomes the fast refinement and observability layer for structure editing, drag-and-drop changes, and live runtime feedback.

The first thing we build is not the GUI. The first thing we build is a **harness for making harnesses**: a Claude Code-native harness-maker harness that lets users chat their way into a new harness project. The GUI is a synchronized editing and visualization layer on top of that engine.

The validation bar is also higher than “exported files exist.” A generated harness counts as valid only when it can run in an isolated environment, avoid collisions with existing harnesses, complete a representative end-to-end flow without manual internal code fixes, and show its runtime behavior and failures back in the GUI.

---

## 2. Problem Statement

### 2.1 Core problem

AI coding agents are becoming general-purpose execution environments. In practice, that is not enough for production use.

Different teams need different constraints:
- finance teams need approval and audit flows,
- healthcare teams need regulated access and validation,
- manufacturing teams need simulation and safety gates,
- legal teams need strict document routing,
- education teams need grading and review loops.

The shared need is not “use Claude Code better.” The shared need is “shape the agent with a harness that reflects domain reality.”

### 2.2 Why current solutions are insufficient

The current generation of harnesses is powerful but developer-native:
- hook scripts are handwritten,
- manifests are edited directly,
- runtime differences are handled manually,
- debugging is log-driven,
- customization requires code literacy.

That excludes the exact teams who most need custom harnesses.

### 2.3 Opportunity

There is currently no dominant tool that acts as a visual authoring environment for AI coding harnesses across Claude Code, OpenCode, and Codex.

Harness Editor creates that category.

---

## 3. Product Vision

Harness Editor is the product that lets a user define how an AI coding agent should behave without directly editing hook code, plugin manifests, or runtime config.

The product has two authoring modes:
- **Chat mode (primary)**: natural-language authoring where the host runtime’s LLM creates and wires blocks automatically in CLI
- **Visual mode (secondary)**: drag-and-drop graph editing with inspector panels after an initial structure exists

The product has one source of truth:
- a canonical harness project on disk

The product has three core surfaces:
- a CLI-native harness-maker for initial generation
- a GUI for structural refinement and observability
- an isolated test environment for validating the generated harness safely

The product has one core promise:

> Users never touch harness code directly. They define behavior; the system compiles runtime-native artifacts.

The long-term vision is larger than V1: over time, Harness Editor can become the platform where open-source harnesses for specific domains are created, shared, and discovered. That long-term ambition does not change the V1 focus, which is reducing the cost of creating harnesses in the first place.

---

## 4. Product Principles

1. **No-code first**  
   Users should never be required to edit `.mjs`, `.ts`, `plugin.json`, `.codex/hooks.json`, or `opencode.json` directly.

2. **Harness-first, GUI-second**  
   The first deliverable is the harness-maker harness. The GUI is a view and interaction layer over that engine.

3. **Target-before-write generation**  
   Users may discuss intent in a runtime-agnostic way, but before scaffold generation the target runtime must be chosen.

4. **Capability-aware authoring**  
   Runtime compatibility must be surfaced while building the graph, not only at export time.

5. **Live behavior over static files**  
   The value is not file generation alone. The value is live sandbox validation and graph-level observability.

6. **Dogfood the architecture**  
   The product should prove itself by using a harness to create harnesses.

---

## 5. Primary Users and Jobs To Be Done

### 5.1 Primary user

The PRD is workflow-first, not persona-first. The key repeated job is more important than the segment label:

> take an intent and turn it into a working CLI harness without hand-authoring low-level runtime code

The primary user is any harness author or operator who needs that job done repeatedly.

This includes:
- platform teams
- AI adoption teams
- internal tooling engineers
- consultants building per-client harnesses
- advanced individual builders operating near engineering workflows

### 5.2 Core jobs to be done

1. Describe a desired harness in CLI chat and get back a working harness skeleton
2. Reuse and recombine proven harness patterns from existing ecosystems
3. Generate runtime, MCP, and hook structures without touching code directly
4. Refine the generated structure visually through drag-and-drop and inspector editing
5. Test the resulting harness in an isolated environment that does not collide with existing setups
6. Observe real runtime flow and failures in the GUI, then iterate quickly

---

## 6. Scope

### 6.1 In scope

- CLI-first harness-maker authoring
- Graph-based harness authoring
- AI-assisted node generation and wiring
- Built-in catalog of atomic primitives and composite patterns
- Custom opaque AI-generated blocks
- Runtime/MCP/server generation as a core product capability
- Novel hooks and novel runtimes as first-class generation targets
- Runtime-aware compatibility filtering
- Claude Code export in Phase 0/1
- OpenCode and Codex compiler backends after core compiler shape is proven
- Independent live sandbox execution with real-time graph highlighting
- GUI-native error surfacing when hooks or runtime parts fail
- Hot reload for iterative testing
- Single-command local launch via `bunx harness-editor`

### 6.2 Explicit non-goals

Out forever:
- multi-user collaboration
- built-in version control UI
- non-harness workflow automation
- general-purpose AI workflow builder for arbitrary automation
- standalone runtime independent of host runtimes
- SaaS auth/billing/team infrastructure

Later, not MVP:
- marketplace/registry
- cloud sandbox execution
- additional runtimes beyond Claude/OpenCode/Codex
- analytics
- decompiler/import from existing harness repos

### 6.3 Long-term vision outside V1

Long-term, Harness Editor may grow into a harness marketplace/platform where domain-specific harnesses are published and discovered as open-source building blocks.

That is not the V1 product. V1 is the environment-harness for making harnesses more easily.

---

## 7. Phase Plan

### 7.1 Phase 0 — Harness-maker harness

Build a full harness for Claude Code that helps a user create harnesses through chat.

This harness is the actual core product.

Responsibilities:
- create and update the harness project on disk
- manage conversation-driven harness authoring
- emit state changes that the GUI can visualize
- enforce the initial project structure
- drive compiler calls
- trigger sandbox runs
- generate and adapt runtime, MCP, and hook structures as part of the authoring flow

Deliverable:
- installable Claude Code harness
- works in CLI-only mode
- can create a new harness project without GUI

### 7.2 Phase 1 — Compiler

Build the compiler that lowers the canonical harness project into runtime-native artifacts.

Phase 1 shipping requirement:
- Claude Code backend fully working and validated

Committed next backends:
- OpenCode
- Codex

### 7.3 Phase 2 — GUI

Build the localhost GUI using React + React Flow.

Responsibilities:
- render graph
- show inspector
- sync with CLI state over WebSocket
- support drag-and-drop and direct editing of AI-generated harness structures
- show compatibility, validation, and runtime error state

### 7.4 Phase 3 — Live sandbox debugger

Build the real-time testing environment.

Responsibilities:
- run a real sandboxed Claude Code session in an isolated non-colliding environment
- stream runtime trace events back to the GUI
- highlight nodes, branches, and state transitions
- surface failure points back to the GUI
- support hot reload

---

## 8. User Flow

### 8.1 Canonical flow

1. User runs `bunx harness-editor`
2. Tool detects available host runtime
3. Tool initializes or opens a harness project
4. User defines intent through CLI chat and gets an initial harness structure
5. User chooses target runtime before scaffold generation
6. Product filters compatible blocks and validation rules
7. User edits graph, skill content, and settings in the GUI
8. User exports runtime-native harness artifacts
9. User runs an isolated live sandbox test that does not collide with existing harnesses
10. Product shows runtime flow and errors back in the GUI in real time
11. User iterates through graph edits and hot reload

### 8.2 Important rule: target selection timing

Runtime selection should not be the first ideation step, but it must happen before artifact generation.

Reason:
- high-level behavior can be discussed generically
- manifests, hook schemas, state roots, install paths, and packaging differ too much across runtimes to defer target choice past scaffold generation

This is a core product rule.

---

## 9. Runtime Strategy

### 9.1 Authoring model

Authoring is partially runtime-agnostic.

Portable concepts:
- skills
- prompts
- conditions
- loops
- state intent
- MCP/tool intent
- delegation intent
- trace intent

Runtime-locked concepts:
- hook vocabulary
- plugin manifest format
- packaging/install layout
- state file locations
- runtime bootstrap code
- exact compiler output

### 9.2 Product implication

The product should be:

> **spec-first, target-before-write**

This means:
- allow generic planning
- require target runtime before scaffold generation
- treat runtime changes later as migrations, not toggles

### 9.3 Runtime order

1. Claude Code first
2. OpenCode second
3. Codex third

---

## 10. System Overview

### 10.1 Core components

1. Harness-maker harness
2. Canonical harness project / IR
3. Runtime compiler backends
4. React Flow GUI
5. WebSocket sync layer
6. Live sandbox debugger

### 10.2 Source of truth

The canonical source of truth is the harness project on disk, not the GUI state.

The GUI is a view and editing interface over that project.

### 10.3 Technical decisions already locked

- Layout lives in a sidecar file
- Semantic IR stays separate from visual layout
- Composites are reference-based
- Harness project uses a directory structure, not one giant YAML file

---

## 11. Harness Project Model

The product needs a canonical project model that the CLI, compiler, GUI, and debugger all agree on.

At a high level, the project contains:
- harness manifest
- semantic graph definition
- composite definitions
- custom blocks
- skill content
- layout sidecar
- compiler output directories

Key rule:
- semantic authoring data and view/layout data remain separate

---

## 12. Block System

### 12.1 Atomic primitives

The product ships with a core atomic set including at least:
- SessionStart
- PreToolUse
- PostToolUse
- UserPromptSubmit
- Stop
- Skill
- Agent
- Condition
- Loop
- StateRead
- StateWrite
- MCPServer
- SystemPrompt
- Permission
- Merge
- Sequence

The exact engineering-facing list must be defined in one authoritative block registry, not repeated ad hoc across docs.

### 12.2 Composite patterns

Day-one composite patterns include:
- Permission Gate
- Review Loop
- Session Init Bundle
- Boulder Continuation
- Ralph Loop
- Subagent Delegation
- 3-Tier MCP Registration
- Lore/Memory Persist
- Evolutionary Seed

### 12.3 Composite behavior

Composites are first-class patterns that:
- can be placed as a single block
- can be expanded to reveal inner nodes
- preserve a clear relationship to their template origin
- compile deterministically

### 12.4 Custom blocks

Users do not write custom code directly.

Instead:
- AI chat can generate a custom opaque code block
- the block behaves as a first-class node
- it exposes typed ports
- it participates in compile and debug flows
- the product clearly shows that the node is opaque/custom logic

---

## 13. AI Authoring Contract

The AI authoring experience is core, not auxiliary.

The product must support:
- graph creation from chat
- graph modification from chat
- generation of composite usage
- generation of custom opaque blocks
- generation of runtime, MCP, and hook structures, including novel ones
- graph updates reflected in the GUI in real time

The AI system must also:
- respect runtime compatibility
- avoid illegal graph states
- make safe defaults when possible
- surface uncertainty when a request implies unsupported runtime behavior

### 13.1 Decision boundary for AI autonomy

The harness-maker AI may decide automatically:
- pattern selection
- node wiring and structural composition
- default runtime and MCP scaffolding
- standard modular recombination choices

The harness-maker AI must ask for confirmation before:
- adding risk-bearing permissions
- weakening or bypassing safety guardrails
- interpreting or changing safety policy in a non-obvious way
- enabling destructive or risky runtime behavior

The PRD intentionally does not lock the exact internal mutation mechanism. That is an implementation detail of the harness-maker harness.

---

## 14. Compiler Contract

### 14.1 Compiler responsibility

The compiler transforms the canonical harness project into runtime-native harness packages.

### 14.2 Claude Code backend requirements

The first backend must emit a working Claude Code harness package including:
- plugin manifest
- skills
- executable hook scripts
- required config surfaces

### 14.3 OpenCode and Codex backends

These are product commitments, but Phase 0 implementation must not pretend they are already done.

The PRD distinguishes:
- **Phase 0 shipping backend**: Claude Code
- **Committed next backends**: OpenCode and Codex

### 14.4 Compiler success definition

“Export works” does not mean files exist.

It means:
- emitted artifacts are structurally valid
- install path is correct
- runtime behavior works in live sandbox
- graph semantics match runtime behavior
- representative runtime and MCP behavior works without manual internal code repair after generation

---

## 15. Sandbox and Debugger Contract

### 15.1 Sandbox definition

The sandbox is a real agent session using the generated harness, not a mock-only preview.

The sandbox must run in an isolated environment that does not collide with the user’s existing harness installations or local working setups.

### 15.2 Debugger definition

The debugger must stream execution back to the graph and show:
- hook/event activation
- branch selection
- state transitions
- loop iterations
- custom block execution boundaries
- error location and failure state when hooks or runtime parts break

### 15.3 Hot reload definition

Hot reload means a user can modify the harness graph and re-run validation without rebuilding the entire testing workflow from scratch.

### 15.4 Production-ready validation bar

For V1, a generated harness is only considered production-ready when:
- it can be installed and executed without manual internal source-code fixes,
- it runs inside an isolated non-colliding test environment,
- a representative end-to-end harness scenario passes,
- and the GUI shows live flow activity plus visible failure points during execution.

---

## 16. Functional Requirements

### FR-1 Project initialization
- User can start with `bunx harness-editor`
- Product detects runtime and initializes project
- Product supports CLI-only mode before GUI is available
- Product supports CLI-first harness creation before any GUI refinement is required

### FR-2 Graph authoring
- User can add, move, connect, delete, and configure nodes
- User can browse atomic and composite catalogs
- User can expand composites into internals

### FR-3 Inspector editing
- User can edit Skill markdown and frontmatter
- User can configure runtime-relevant properties

### FR-4 Chat authoring
- User can ask AI to add and modify graph structures
- AI updates the graph in real time
- AI can generate custom opaque blocks
- AI can generate runtime, MCP, and hook structures as part of harness creation
- AI can generate novel hook and runtime structures, subject to explicit safety boundaries

### FR-5 Compatibility awareness
- Graph surface shows runtime compatibility indicators
- Incompatible generation paths are blocked or clearly warned

### FR-6 Export
- User can export a Claude Code harness package
- Later: user can export OpenCode and Codex packages

### FR-7 Testing
- User can run the generated harness in an isolated live sandbox that does not conflict with existing harnesses
- User can observe runtime execution and error states visually
- User can iterate without full restart

### FR-8 Harness-maker dogfooding
- The harness-maker itself can author harnesses in Claude Code

---

## 17. Non-Functional Requirements

- Local-first: no required SaaS backend
- MIT open source
- Host-runtime LLM usage: no separate API key required for core AI authoring flow
- Deterministic compile path for built-in blocks and composites
- Acceptable responsiveness for AI-driven node generation
- Clear failure states for unsupported target/runtime combinations
- Isolated test environments must avoid collisions with existing harness setups
- Safety-sensitive AI actions must require explicit confirmation

---

## 18. Success Metrics

### 18.1 Product success

- A user can create a useful harness without editing code
- A user can understand runtime behavior from the graph alone
- A user can export a working Claude Code harness package
- A user can generate a working harness from CLI intent before using the GUI
- A user can test the generated harness in an isolated environment with visible runtime trace

### 18.2 Execution success

- Phase 0 harness-maker is self-hosting
- Golden path passes end-to-end
- Debugger fidelity is high enough that users trust the visual trace
- Generated harnesses do not require manual internal code repair to pass representative validation

### 18.3 Quality bar

The strongest success metric is not adoption-first. It is **functional correctness**.

The exported harness must actually behave correctly in the live sandbox.

For V1, “correctly” specifically means:
- isolated environment,
- representative E2E pass,
- no manual internal code fixes after generation,
- live GUI trace,
- GUI-visible error surfacing.

---

## 19. Golden Path Acceptance Scenario

The product is considered phase-complete when the following flow works:

1. User runs `bunx harness-editor`
2. Product opens project and canvas
3. User sees catalog and chat
4. User places or requests a composite pattern
5. User edits skill content in inspector
6. User adds a loop and routing logic through chat
7. Product shows runtime compatibility state
8. User exports to Claude Code
9. User launches an isolated sandbox test with no collision against existing harnesses
10. Graph lights up in real time during execution
11. If a hook or runtime part fails, GUI shows where and how it failed
12. User edits graph and hot reloads
13. Harness-maker itself can produce another harness project through the same flow

---

## 20. Risks

1. **Phase sprawl**  
   Trying to truly ship all runtimes at the same depth too early.

2. **No-code promise erosion**  
   If users repeatedly need to inspect generated code, the product loses its core identity.

3. **Debugger gap**  
   If the live trace is weak or misleading, the product becomes just another file generator.

4. **Catalog incoherence**  
   If block definitions are duplicated across docs and code, implementation will drift immediately.

5. **Runtime abstraction failure**  
   If the product hides incompatibilities instead of surfacing them, users will distrust exports.

6. **Novel runtime over-promise**  
   If the product claims production-ready novel hooks or runtimes without a strong proof bar, the PRD will promise more than the implementation can validate.

7. **Isolation complexity**  
   If the test environment is not truly isolated, generated harnesses may interfere with existing local harnesses and undermine trust immediately.

---

## 21. Open Questions for Engineering

These are implementation questions, not unresolved product ambiguity:
- exact block registry schema
- exact project file layout
- event trace schema for debugger
- opaque custom block lifecycle and validation
- composite instance/reference semantics
- hot reload boundary
- migration model when changing runtimes after project creation

---

## 22. Release Criteria for Development Kickoff

Implementation should begin if the team aligns on these statements:

1. The first product is the harness-maker harness, not the GUI.
2. Claude Code is the first concrete runtime target.
3. Runtime must be chosen before scaffold generation.
4. The canonical harness project is the source of truth.
5. The GUI is a synchronized editing/view layer over that project.
6. The debugger is a core requirement, not a nice-to-have.
7. Functional correctness in live sandbox is the validation bar.
8. The validation bar includes isolated environment execution, representative E2E pass, live trace visibility, and GUI error surfacing.
9. The harness-maker AI may auto-decide structure and baseline scaffold, but risky permissions and safety-affecting changes require explicit confirmation.

---

## Appendix A — Source Inputs

This PRD was derived from:
- `seed_harness_editor.yaml`
- `HARNESS_EDITOR_PROPOSAL.md`
- prior interview decisions locked in the harness-editor seed process
- codebase analysis of omc, omo, ouroboros, omx, superpowers, and gstack
