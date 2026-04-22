# Phase 0 Review Notes

This document started as a review of the original Phase 0 scaffold. The repo has moved well beyond that narrow baseline, so this page now serves two purposes:

1. preserve what the original Phase 0 slice proved
2. record which early gaps are now closed versus which ones still meaningfully remain

For current product-level status, prefer the OMOH planning/state artifacts under `.omx/plans/oh-my-openharness/`.

## What the original Phase 0 slice proved

The initial scaffold already established:

- a canonical project shape on disk
- a CLI-first flow for project creation and validation
- compiler output generation
- isolated sandbox validation with trace artifacts
- early automated smoke coverage

That narrow loop was real and useful:

`intent -> canonical project -> runtime bundle -> isolated validation -> trace artifacts`

## What is no longer accurate from the older review

Several gaps called out in the original version have since been closed or materially reduced.

### Safety confirmation behavior is no longer only structural

The older review said the repo had no interactive confirmation/refusal path. That is now stale.

Current behavior includes:

- risky generation blocked unless confirmation is provided
- interactive CLI confirmation/refusal support in `chat`
- summary approval handling in `setup`
- host/runtime readiness surfaced separately in `doctor`

### The GUI is no longer a narrow read-only shell

The earlier review predated the current browser editor capabilities.

Today the browser surface can:

- mutate the canonical graph
- persist layout
- preserve host-authored authoring state across safe graph edits
- surface trace/debug overlays and stale-trace state

### Trace/debug fidelity is stronger than the original review implied

The trace contract now includes typed event handling, graph-hash awareness, and stale-trace surfacing in the local server/browser path. The earlier review's "partially formalized" warning is still useful as historical context, but it under-describes the current implementation.

### Test coverage is substantially broader

The suite now covers far more than the original three-smoke-test subset. Current automated coverage includes:

- runtime-specific compile/export paths
- setup and doctor behavior
- host-authoring bridge persistence
- server/browser mutation behavior
- graph-hash stale-trace handling
- import-seed flow
- published-style bin entrypoint behavior
- phase-5 proof-audit validation

## Gaps that still meaningfully remain

Not every original concern is fully gone.

### 1. Registry-driven generation is still not fully sovereign

The old concern that the registry is not yet the sole generation authority still appears materially valid. The repo has improved around runtime targeting and authoring state, but the generation path is not yet a pure registry-driven emitter.

### 2. Automated proof is not the same thing as a live hosted session

The project now has runtime-aware setup/doctor/author/export/import/sandbox coverage, but the automated suite still validates the local bundle/orchestration surface rather than driving a full external host UI session end-to-end.

### 3. Documentation can lag implementation quickly

This is now a demonstrated recurring issue: code/tests/proofs advanced beyond older README/docs wording, and honesty reconciliation was needed to bring the docs back in line.

## Current confidence

This repository is **not** just a Phase 0 scaffold anymore. It now supports a much broader OMOH contract around setup, host-aware authoring persistence, browser editing, runtime-specific export, validation, and bounded import seed behavior.

A more accurate current statement is:

- the original Phase 0 baseline is solidly proven
- several once-open gaps are now closed
- the remaining meaningful gaps are about deeper generation authority, doc drift, and how much live host behavior is proven directly by automation versus by bounded scenario evidence

## See also

- `README.md` — top-level project surface and commands
- `docs/gui-shell-contract.md` — current browser editor/server contract
- `.omx/plans/oh-my-openharness/ACTIVE/current-state.md` — current OMOH execution summary
