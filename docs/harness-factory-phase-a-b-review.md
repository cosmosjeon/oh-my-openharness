# Harness Factory Phase A+B Review Notes

This note records the verification lane for the first Harness Factory slice.

The repository is still shipping the stable OMOH substrate today. Phase A+B should layer on top of that substrate instead of rewiring it underneath the existing CLI/compiler/web/sandbox loop.

## Current implementation contract

### Phase A — stabilize the substrate boundary

Phase A is successful when:

- new code stays additive under `src/factory/`
- the existing engine under `src/core`, `src/compiler`, `src/web`, and `src/sandbox` does not grow reverse imports into `src/factory`
- the low-level substrate commands remain visible and callable: `new`, `author`, `serve`, `sandbox`, and `export`
- the canonical project loop remains the same engine the future factory will drive

### Phase B — seed the reference pattern layer

Phase B is successful when:

- `src/factory/reference/pattern-registry.json` lands as additive data over the stable substrate
- each seeded pattern keeps source provenance so a reader can trace where it came from
- each seeded pattern carries enough descriptive text to explain why it matches a requested capability
- the first manual seed set covers:
  - approval gate
  - review loop
  - MCP registration
  - memory persistence
  - retry loop
  - subagent delegation

The review lane intentionally does **not** lock one exact JSON shape yet, but it does expect each registry entry to keep:

- a stable `id`
- source-repo provenance (`sourceRepo`, `source.repo`, or equivalent nested repo metadata)
- capability labels or tags
- a short summary / why / description field

## What this lane locks now

`tests/factory-phase-a-b-contract.test.ts` protects three things:

1. the CLI still advertises the stable substrate commands needed for the Phase A boundary
2. non-factory source files do not import the future `src/factory` namespace during Phase A+B
3. the Phase B registry contract is documented now and will be validated automatically once `src/factory/reference/pattern-registry.json` exists

## Intentional limits

- This lane does not refactor the substrate.
- It does not prescribe the exact internal types that worker-owned factory modules must use.
- If later phases intentionally wire factory behavior into the top-level CLI or hook surfaces, update this note and the dependency-direction guard together instead of weakening the guard silently.

## Verification commands

- `bun test tests/factory-phase-a-b-contract.test.ts`
- `bunx tsc --noEmit`
- `bun run test`

## Review outcome for the current branch

The additive `src/factory` Phase A+B slice is now present on this branch. The review guard should continue to protect the substrate boundary while allowing future factory modules to grow under `src/factory/`.
