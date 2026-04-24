# Next Session Team Prompt — Harness Factory Phase C/D Start

Use this prompt verbatim in the next Codex/OMX session from `/Users/cosmos/Documents/harness`.

```text
/Users/cosmos/Documents/harness 에서 작업을 재개해라.

ulw $team

## 현재 상태 요약

이 레포의 OMOH는 stable substrate 위에 Harness Factory 제품 레이어를 얹는 방향으로 전환 중이다.
이전 세션에서 Phase A+B의 첫 additive slice가 구현/검증됐다.

중요한 최신 커밋:
- `d2e68e2` Preserve Harness Factory direction for parallel execution
- `4c72c40` Make Harness Factory stateful enough to drive the substrate
- `25b9213` Restore the Factory Phase A+B API after team auto-merges

현재 검증 상태:
- `bunx tsc --noEmit` green
- `bun run test` green: 90 pass, 0 fail
- `git status --short` clean 상태에서 시작해야 한다

## 반드시 먼저 읽을 파일

이 순서로 읽어라.

1. `AGENTS.md`
2. `README.md`
3. `docs/usage-ko.md`
4. `docs/harness-factory-plan.md`
5. `docs/harness-factory-phase-a-b-review.md`
6. `docs/harness-factory-next-session-team-prompt.md`
7. `HARNESS_EDITOR_PROPOSAL.md`
8. `HARNESS_EDITOR_PRD.md`
9. `seed_harness_editor.yaml`

그리고 현재 구현 파일을 확인해라:

- `src/factory/index.ts`
- `src/factory/state/schema.ts`
- `src/factory/state/store.ts`
- `src/factory/reference/pattern-registry.json`
- `src/factory/reference/catalog.ts`
- `src/factory/reference/search.ts`
- `src/factory/synthesis/draft-spec.ts`
- `src/factory/synthesis/capability-mapping.ts`
- `src/factory/actions/substrate.ts`
- `tests/factory-state.test.ts`
- `tests/factory-reference.test.ts`
- `tests/factory-integration.test.ts`
- `tests/factory-phase-a-b-contract.test.ts`

Reference harness 소스는 필요할 때만 읽어라:
- `oh-my-codex/`
- `oh-my-claudecode/`
- `oh-my-openagent/`
- `ouroboros/`
- `superpowers/`
- `gstack/`

## 이미 확정된 방향

다시 broad planning 하지 마라.
방향은 확정됐다.

- 현재 OMOH substrate는 유지한다.
- 새 제품 레이어는 `src/factory/` 아래에 additive로 만든다.
- 기존 canonical project model이 source of truth다.
- Factory는 새 source of truth가 아니라 기존 substrate를 감싸는 제품 레이어다.
- reference harness들은 dead snapshot이 아니라 pattern source다.
- 기존 `new / author / serve / sandbox / export / import / compile / setup / doctor`를 깨뜨리지 마라.

## 이번 세션 목표

이번 세션은 Phase C 중심, 가능하면 Phase D의 최소 seam까지 간다.

핵심 목표:

1. `src/factory/interview/`에 focused interview engine 구현
   - `nextQuestion(state)`
   - `applyAnswer(state, answer)`
   - `isReadyToDraft(state)` 또는 동등한 readiness helper
   - 질문은 한 번에 하나씩 선택 가능해야 한다.
   - open questions는 답변 후 줄어들어야 한다.
   - confirmed decisions는 답변으로 누적되어야 한다.

2. reference registry와 interview 연결
   - requested capabilities / user intent 기반으로 reference patterns를 제안/선택
   - `approval`, `mcp`, `state`, `review`, `retry`, `subagent`에 대해 최소 질문을 만들 것
   - 이미 있는 `src/factory/reference/*` API를 재사용하고, 필요하면 작게 확장

3. Factory state → draft → canonical project vertical slice 강화
   - answer application 후 `synthesizeDraftGraphSpec`
   - `materializeFactoryDraft`로 canonical project 생성
   - 생성된 project가 기존 `loadHarnessProject`, `compileCanonicalProject`, `verifyCanonicalProject` 경로로 이어져야 한다

4. 최소 hook/router seam 시작 가능하면 추가
   - `src/factory/hooks/`에 아직 실제 Claude hook 구현을 크게 만들 필요는 없다.
   - 단, Phase D를 위해 `routeFactoryPrompt(state, userPrompt)` 같은 pure function seam은 추가 가능하다.
   - 실제 runtime hook script wiring은 다음 단계로 남겨도 된다.

5. 테스트/문서 갱신
   - interview unit tests
   - answer application state round-trip tests
   - reference-pattern-assisted question selection tests
   - minimal integration test: intent -> question -> answer -> draft -> materialize -> compile or sandbox
   - docs 업데이트: `README.md`, `docs/usage-ko.md`, `docs/harness-factory-plan.md` 중 필요한 곳만 작게

## 팀모드 staffing 제안

`omx team 3:executor "Harness Factory Phase C interview vertical slice over the existing Phase A+B factory layer. Worker-1 owns src/factory/interview nextQuestion/applyAnswer/readiness helpers. Worker-2 owns reference-pattern-to-question mapping and any small reference API extensions. Worker-3 owns tests/docs verification lane, including integration test intent -> answer -> draft -> materialize -> compile/verify. Keep all changes additive under src/factory, do not refactor substrate, and keep bunx tsc --noEmit plus bun run test green."`

팀 런타임이 dirty workspace 때문에 막히면:
- 먼저 `git status --short` 확인
- 필요한 문서/context 변경이 있으면 Lore commit으로 커밋
- 그 후 `omx team ...` 재시도

## acceptance criteria

세션 종료 시 최소 만족해야 할 것:

- `src/factory/interview/`가 placeholder가 아니라 실제 API를 가진다.
- `nextQuestion(state)`가 capability/reference 기반으로 focused question을 반환한다.
- `applyAnswer(state, answer)`가 open questions / confirmed decisions / requested capabilities / target runtime 중 최소 일부를 갱신한다.
- interview state에서 draft synthesis와 materialize adapter까지 이어지는 최소 integration test가 있다.
- 기존 substrate reverse import가 없다.
- 기존 CLI commands는 계속 advertise/callable하다.
- `bunx tsc --noEmit` green
- `bun run test` green
- 팀모드 사용 시 tasks terminal 상태 확인 후 `omx team shutdown <team-name>`으로 정상 종료한다.

## 하지 말 것

- broad replan 금지
- Harness Editor GUI를 이번 세션 중심으로 바꾸지 마라
- current OMOH substrate low-level polishing에 시간을 쓰지 마라
- 기존 canonical project model을 대체하는 새 IR/source-of-truth 도입 금지
- reference registry를 링크 모음으로만 두고 interview/synthesis와 연결하지 않는 설계 금지
- 새 dependency 추가 금지

## 보고 형식

진행 보고는 짧게:
- current lane
- current action
- evidence changed
- next action

최종 보고에는 반드시 포함:
- changed files
- simplifications made
- verification evidence
- remaining risks
- 다음 세션에서 Phase D hook routing으로 이어지는 구체적 다음 작업

지금 바로 실행 시작.
```

## Plan documents to keep referencing

- `docs/harness-factory-plan.md` — canonical product/phase plan; Phase C/D/E/F definitions live here.
- `docs/harness-factory-phase-a-b-review.md` — boundary guard for the stable OMOH substrate and seeded pattern registry contract.
- `README.md` — public-facing substrate + Factory layer positioning.
- `docs/usage-ko.md` — Korean user-facing explanation of substrate vs Factory.
