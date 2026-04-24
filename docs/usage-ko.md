# oh-my-openharness 한국어 사용 가이드

이 문서는 `oh-my-openharness`(OMOH)를 **처음 쓰는 사람도 바로 따라할 수 있게** 한국어로 쉽게 설명한 가이드입니다.


---

## Harness Factory 레이어는 무엇인가요? (진행 중)

현재 OMOH의 `new / author / serve / sandbox / export / import / compile / setup / doctor`는 계속 **안정적인 엔진(substrate)** 으로 유지됩니다.

그 위에 새로 추가되는 **Harness Factory** 레이어는 앞으로 다음 흐름을 담당합니다.

1. 사용자가 만들고 싶은 하네스를 자연어로 설명
2. Factory가 reference harness 패턴(approval gate, review loop, MCP registration, state persistence, retry loop, subagent delegation)을 찾음
3. 필요한 질문을 상태에 저장하면서 reference pattern 기반으로 한 번에 하나씩 질문
4. draft graph spec을 만들고 기존 canonical project 모델로 materialize
5. 기존 `serve`, `sandbox`, `export`, `import` 엔진을 action adapter로 호출

현재 구현은 `src/factory/` 아래에 추가되며, Phase C부터 `nextQuestion` / `applyAnswer` 인터뷰 API와 순수 hook router seam을 포함합니다. 기존 canonical project 구조를 대체하지 않습니다. 즉 Factory는 새 source of truth가 아니라 **현재 OMOH 엔진을 감싸는 제품 레이어**입니다.

---

## 1. 이 도구가 뭐하는 거야?

OMOH는 AI 코딩 에이전트 워크플로를 위해 만든 **로컬 CLI + 브라우저 에디터 도구**입니다.

쉽게 말하면:

- Claude / OpenCode / Codex 같은 호스트 런타임을 대상으로
- 하나의 **canonical harness project**를 디스크에 만들고
- 그 프로젝트를 **브라우저 노드 뷰**로 보고/편집하고
- runtime-specific bundle로 export하고
- sandbox로 trace/validation까지 확인할 수 있게 해줍니다.

즉, “프롬프트만 넣고 끝”이 아니라,
**프로젝트 파일 + 그래프 + 런타임 의도 + 에디터 + 검증**까지 묶어서 다루는 도구라고 보면 됩니다.

---

## 2. 먼저 알아둘 것

### OMOH가 잘 맞는 경우

- 로컬에서 Claude / OpenCode / Codex용 harness를 만들고 싶다
- 노드/엣지 구조를 브라우저에서 보고 편집하고 싶다
- export / import / sandbox 검증까지 한 흐름으로 쓰고 싶다

### OMOH가 아닌 것

- 퍼블릭 SaaS 웹앱이 아님
- 멀티유저 협업 도구가 아님
- 클라우드 실행 플랫폼이 아님
- 호스트 런타임 기능을 100% 클론하는 제품이 아님

### 현재 계약(쉽게)

OMOH는 **로컬 단일 사용자용 도구**로 생각하면 가장 정확합니다.

- `serve`는 기본적으로 로컬(loopback)에서 쓰는 용도
- 브라우저에서 편집하려면 mutation token 필요
- `author`는 해당 호스트 CLI가 **설치 + 로그인 완료** 상태여야 함

---

## 3. 사전 준비물

### 필수

- **Bun**
- **Node.js**

> OMOH는 설치/실행은 Bun-first지만, 생성된 hook/MCP bridge script들은 현재 `node`로 실행됩니다.  
> 그래서 **Node도 반드시 있어야** 합니다.

### 런타임별 추가 준비

- Claude를 쓸 거면 `claude` CLI 설치 + 로그인
- OpenCode를 쓸 거면 `opencode` CLI 설치 + 로그인
- Codex를 쓸 거면 `codex` CLI 설치 + 로그인

---

## 4. 가장 쉬운 시작법

### 설치

프로젝트 repo 안이라면:

```bash
bun install
```

퍼블리시된 패키지로 바로 쓰려면:

```bash
bunx oh-my-openharness
```

도움말 보기:

```bash
bunx oh-my-openharness --help
```

---

## 5. 가장 추천하는 첫 사용 흐름

아래가 제일 무난한 입문 루트입니다.

### Step 1. 새 harness 만들기

예시: Claude Code용 harness

```bash
bunx oh-my-openharness new \
  --name demo-harness \
  --runtime claude-code \
  --prompt "Create a harness with approvals, MCP server support, and state memory" \
  --dir . \
  --confirm-risk
```

이 명령을 실행하면 `./demo-harness` 폴더가 생깁니다.

주요 파일 구조는 대략 이렇게 됩니다:

```text
demo-harness/
  harness.json
  layout.json
  graph/
    nodes.json
    edges.json
  skills/
  compiler/
  sandbox/
```

### Step 2. 브라우저 노드 뷰 열기

```bash
bunx oh-my-openharness serve --project ./demo-harness
```

그러면 JSON이 출력됩니다:

```json
{
  "url": "http://127.0.0.1:43001",
  "host": "127.0.0.1",
  "port": 43001,
  "apiToken": "....",
  "mutationProtection": "token+same-origin"
}
```

여기서 중요한 건 2개입니다:

- `url` → 브라우저에서 여는 주소
- `apiToken` → 편집할 때 브라우저 화면의 **Mutation token** 칸에 넣는 값

### Step 3. 브라우저에서 확인할 것

브라우저를 열면:

- 왼쪽: summary / confirmations / node list / editor controls
- 가운데: 노드/엣지 그래프
- 오른쪽: trace/debug 패널

여기서 가능한 작업:

- node 추가
- node label/config 수정
- node 삭제
- edge 추가
- edge 삭제
- layout 드래그 이동
- layout 저장
- sandbox trace overlay 확인

### Step 4. 검증(sandbox)

다른 터미널에서:

```bash
bunx oh-my-openharness sandbox --project ./demo-harness
```

정상이라면 이런 핵심 신호를 보면 됩니다:

- `"success": true`
- `"missingEventTypes": []`
- `"violations": []`

즉:
- 현재 프로젝트 구조가 유효하고
- trace schema도 맞고
- runtime intent / hooks / MCP 흐름이 기대대로 검증된다는 뜻입니다.

### Step 5. export

```bash
bunx oh-my-openharness export --project ./demo-harness
```

이 명령은 runtime-specific bundle을 생성합니다.

### Step 6. import

export한 결과를 다시 canonical project로 seed-import하려면:

```bash
bunx oh-my-openharness import \
  --from ./demo-harness/export/claude-code \
  --name imported-demo \
  --dir .
```

---

## 6. `new`와 `author`의 차이

많이 헷갈리는 부분이라 따로 설명합니다.

### `new`

```bash
bunx oh-my-openharness new ...
```

- 로컬 generator 기반으로 canonical harness를 만듭니다
- 가장 안정적이고 예측 가능
- 입문자는 보통 `new`부터 시작하는 걸 추천

### `author`

```bash
bunx oh-my-openharness author ...
```

- 선택한 호스트 CLI(Claude/OpenCode/Codex)에 authoring을 요청합니다
- host-authored delta를 받아 canonical graph를 수정합니다
- 더 강력하지만, **해당 호스트 CLI가 설치 + 로그인**되어 있어야 합니다

즉:

- **처음 시작** → `new`
- **호스트 런타임의 authoring 성격까지 쓰고 싶다** → `author`

---

## 7. Claude만 쓰고 싶으면

Claude-only workflow는 아래처럼 생각하면 됩니다.

### 1) Claude bridge 설치

```bash
bunx oh-my-openharness setup --runtimes claude --yes
```

### 2) 상태 확인

```bash
bunx oh-my-openharness doctor --runtimes claude
```

### 3) 프로젝트 만들기

가장 쉬운 방법:

```bash
bunx oh-my-openharness new \
  --name claude-demo \
  --runtime claude-code \
  --prompt "Create a harness with approvals, MCP server support, and state memory" \
  --dir . \
  --confirm-risk
```

### 4) Claude에서 직접 작업

프로젝트 폴더로 들어간 뒤:

```bash
cd ./claude-demo
claude
```

Claude 안에서 이런 식으로 말하면 됩니다:

```text
Inspect this harness project and explain what nodes, edges, runtime intents, and confirmations are currently defined. Do not change anything yet.
```

또는

```text
Extend this harness so it adds one new condition node and one review-oriented edge while preserving the current graph.
```

### 5) 다시 검증

Claude가 수정한 뒤:

```bash
bunx oh-my-openharness sandbox --project ./claude-demo
```

필요하면 브라우저 뷰도 같이 띄우면 됩니다:

```bash
bunx oh-my-openharness serve --project ./claude-demo
```

---

## 8. 브라우저 노드 뷰는 어디까지 구현돼 있나?

현재 로컬 editor 계약 기준으로는 꽤 많이 구현되어 있습니다.

### 이미 되는 것

- 그래프 렌더링
  - nodes
  - edges
  - layout
- 편집
  - add node
  - update node label/config
  - delete node
  - add edge
  - delete edge
  - drag-and-drop layout
  - save layout
- trace/debug
  - sandbox trace 표시
  - stale trace 감지
  - failure/error 표시
  - trace auto-refresh
  - auto-refresh 실패 시 경고 표시 + retry backoff

### 주의

이건 **로컬 단일 사용자용 editor**로 이해해야 정확합니다.

- 퍼블릭 공개 서비스용 멀티유저 editor 아님
- 브라우저에서 write 하려면 mutation token 필요
- `serve --host 0.0.0.0` 같은 식의 넓은 공개는 별도 보안 판단이 필요한 영역

---

## 9. 주요 명령 한 줄 설명

### `setup`

런타임 bridge 설치/설정

```bash
bunx oh-my-openharness setup --runtimes claude,codex --yes
```

### `doctor`

설치 상태 / host readiness 안내 확인

```bash
bunx oh-my-openharness doctor --runtimes claude
```

### `new`

새 canonical harness 생성

### `author`

호스트 CLI 기반 authoring 반영

### `compile`

runtime-specific compiler output 생성

### `export`

portable runtime bundle 생성

### `import`

runtime bundle에서 bounded seed import

### `sandbox`

trace/validation 실행

### `serve`

로컬 브라우저 에디터 실행

### `catalog`

사용 가능한 registry/composite 정보 출력

### `demo`

빠른 demo flow

---

## 10. 실제로 많이 쓰는 예시

### 빠른 end-to-end

```bash
mkdir omoh-demo && cd omoh-demo

bunx oh-my-openharness new \
  --name demo-harness \
  --runtime codex \
  --prompt "Create a harness with approvals, MCP server support, and state memory" \
  --dir . \
  --confirm-risk

bunx oh-my-openharness serve --project ./demo-harness
# 브라우저에서 url 열기
# apiToken을 Mutation token 칸에 붙여넣기

bunx oh-my-openharness sandbox --project ./demo-harness
bunx oh-my-openharness export --project ./demo-harness
```

### import까지 포함

```bash
bunx oh-my-openharness import \
  --from ./demo-harness/export/codex \
  --name imported-demo \
  --dir .
```

---

## 11. 문제 생기면 어디를 보나

### `author`가 실패한다

보통 원인은:

- 해당 host CLI가 없음
- 로그인 안 됨
- 사용량 제한 걸림

예:

- `claude` 사용량 제한
- `codex` auth 문제

먼저 직접 CLI가 되는지 확인:

```bash
claude --version
codex login status
opencode --help
```

### 브라우저에서 편집이 안 된다

확인 순서:

1. `serve`를 다시 띄웠는가
2. 브라우저에 **Mutation token**을 입력했는가
3. token이 현재 세션에서 출력된 최신 값인가

### `sandbox` 결과를 어떻게 읽나

제일 중요한 값:

- `success`
- `events`
- `validation.missingEventTypes`
- `validation.violations`

정상:

- `success: true`
- `missingEventTypes: []`
- `violations: []`

---

## 12. 마지막으로 정말 간단한 사용 순서

처음 쓰는 사람은 이 4개만 기억하면 됩니다.

1. `new` — 프로젝트 만들기  
2. `serve` — 브라우저에서 보기/편집  
3. `sandbox` — 검증하기  
4. `export` — 번들 만들기  

그리고 Claude/OpenCode/Codex를 더 적극적으로 쓰고 싶을 때 `author`를 추가하면 됩니다.

---

## 13. 관련 문서

- [README.md](../README.md)
- [gui-shell-contract.md](./gui-shell-contract.md)
- [phase0-review.md](./phase0-review.md)
