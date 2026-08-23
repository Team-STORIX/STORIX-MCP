---
name: storix-mcp
description: STORIX 공식 MCP(서버 이름 storix)를 붙이고 쓴다. 최초 등록·인증, 연결 상태 점검, dev API 호출용 토큰 확보, swagger 모듈 툴 사용을 안내한다. "MCP 붙여줘", "MCP 연결 확인", "스웨거 MCP 인증", "API 스펙 봐줘", "릴리스 전 스펙 비교" 요청 시 사용.
---

# STORIX MCP

서버는 `storix` 하나. 기능은 모듈이고 툴 이름은 `<모듈>_<기능>`이다.

| 모듈 | 툴 접두사 | 하는 일 |
|---|---|---|
| swagger | `swagger_` | dev Swagger 스펙 조회·호출·버전 비교 |

저장소: `~/Desktop/Coding/MCP/storix-mcp` (독립 git, 원격 없음, 빌드 없음)

## 인증은 세 겹이고 서로 다른 것이다

섞으면 계속 헤맨다.

| 겹 | 무엇을 여는가 | 값 | 없으면 |
|---|---|---|---|
| ① 스펙 읽기 | 서버가 `dev.storix.kr/v3/api-docs`를 읽음 | `SWAGGER_USER`/`SWAGGER_PASSWORD` (basic) | 모든 툴이 401 |
| ② MCP 접속 | 원격 MCP에 클라이언트가 붙음 | `MCP_BASIC_USER`/`MCP_BASIC_PASSWORD` | HTTP 모드에서만 해당. stdio는 불필요 |
| ③ API 호출 | `swagger_call_api`가 dev에 실제 요청 | `STORIX_DEV_TOKEN` (Bearer JWT) | 호출은 되고 401이 돌아옴 |

**비밀번호를 파일에서 찾아 읽지 마라.** `application.yml`에는 swagger 비밀번호 말고도 시크릿이 같이 있다.
없으면 사용자에게 `!` 로 직접 넣어달라고 요청한다.

## 1. 상태부터 본다

```bash
claude mcp list 2>&1 | grep storix
```

`claude mcp list`는 **현재 디렉터리 기준**이다. 프로젝트 스코프로 등록하면 그 프로젝트 밖에서는
아예 안 보인다. 그래서 이 서버는 전역(`--scope user`)으로 등록해 어디서든 잡히게 해둔다.

- `✔ Connected` → 등록·① 인증 끝. 3번으로 간다.
- `✘ Failed` → 경로나 ①번 값이 틀렸다. 4번.
- 아무것도 안 나옴 → 등록 안 됐다. 2번.

## 2. 최초 등록 (①번 인증)

```bash
claude mcp add storix --scope user \
  -e SWAGGER_BASE_URL=https://dev.storix.kr \
  -e SWAGGER_USER='<계정 — 팀 시크릿 참고>' \
  -e SWAGGER_PASSWORD='<사용자에게 받는다>' \
  -- node ~/Desktop/Coding/MCP/storix-mcp/src/index.js
```

`--scope user`면 어느 저장소에서 작업하든 잡힌다 (백엔드, MCP 저장소, 프론트).
자격증명은 `~/.claude.json`에만 남고 저장소로 새지 않는다 — `--scope project`는 `.mcp.json`을
저장소에 만들어 커밋되므로 쓰지 마라.
등록 후 **Claude Code를 재시작해야** 툴이 잡힌다. `claude mcp list`로 `✔ Connected` 확인.

쓰기 메서드까지 열려면 `-e SWAGGER_MCP_ALLOW_WRITE=true`. 켜면 AI가 dev 데이터를 실제로 바꿀 수 있다.
이건 사람이 설정에 넣는 스위치지 툴 인자가 아니다 — 인자였으면 AI가 스스로 켤 수 있어 관문이 못 된다.

## 3. 툴 (swagger 모듈)

| 툴 | 쓸 때 |
|---|---|
| `swagger_list_endpoints` | 어떤 API가 있는지 찾을 때. `keyword`/`tag`/`method` 필터 |
| `swagger_get_endpoint` | 그 API의 요청·응답 스키마를 `$ref`까지 펼쳐서 볼 때 |
| `swagger_get_schema` | DTO 하나를 이름으로 볼 때. 이름 생략하면 전체 목록 |
| `swagger_call_api` | dev에 진짜 요청을 보낼 때 (③번 토큰 필요) |
| `swagger_snapshot_spec` | 지금 스펙을 라벨 붙여 저장. 라벨 생략하면 목록 |
| `swagger_diff_spec` | 스냅샷 대비 뭐가 바뀌었는지, 호환성 깨지는 건 따로 |
| `swagger_refresh_spec` | 배포 직후 최신 스펙이 안 보일 때 캐시 버리기 |

경로는 항상 `swagger_list_endpoints`가 준 형태 그대로 넣는다 (`/api/v1/users/{userId}`).

### 순서

찾기 → 상세 → 필요하면 호출. 스키마를 안 보고 `swagger_call_api`부터 부르지 마라. 바디 모양을 지어내게 된다.

## 4. ③번 토큰이 필요할 때

`swagger_call_api`가 401을 주면 토큰이 없거나 만료된 것이다. MCP 자체에는 로그인 기능이 없다.
`storix-local-test` 스킬의 테스터 pendingId 로그인으로 JWT를 받아서 **툴 인자 `token`으로 넘긴다.**
매번 넘기기 번거로우면 사용자가 등록 env에 `STORIX_DEV_TOKEN`을 넣으면 되지만, JWT는 만료되므로 인자 쪽이 낫다.

## 5. 릴리스 전 스펙 비교

```
스냅샷 v2.4.2 저장해줘        → swagger_snapshot_spec { label: "v2.4.2" }
(배포 후)
v2.4.2 대비 뭐 바뀌었어       → swagger_diff_spec { from: "v2.4.2" }
```

breaking으로 분류: 엔드포인트·필드·응답 상태코드 제거, 타입 변경, 필수 파라미터 추가,
요청 필드가 선택→필수, 응답 필드가 필수→선택, 응답이 nullable로, 요청 enum 값 제거, 인증 요구 변경.

경로 변경은 rename을 못 알아보고 "제거 + 추가"로 나온다. description·example 변경은 일부러 무시한다.

## 6. 안 될 때

| 증상 | 원인 |
|---|---|
| 툴이 아예 안 보임 | 등록 후 재시작을 안 했다 |
| `claude mcp list`에 안 나옴 | 다른 디렉터리에서 쳤다. 프로젝트 스코프로 등록됐는지 확인 |
| 옛 이름(`mcp__storix-swagger__*`)이 보임 | 이름 변경 전 세션이다. 재시작 |
| 전부 401 | ①번 basic auth 값 |
| `swagger_call_api`만 401 | ③번 JWT |
| 스펙이 옛날 것 | `swagger_refresh_spec`. 캐시 TTL 60초 |
| 쓰기 메서드가 막힘 | 의도된 것. 사용자가 `SWAGGER_MCP_ALLOW_WRITE=true`를 넣어야 한다 |

## 7. HTTP 모드 (프론트에게 배포할 때, 아직 미배포)

`src/http.js`를 띄우면 `/mcp` 하나로 서비스되고, 프론트는 클론 없이 URL만 등록하면 된다.
이때 ②번 인증이 붙는다. 스모크 검사는 `node smoke-http.mjs` (무인증 401 / 낯선 Origin 403 / healthz 200 / 툴 개수 / 쓰기 차단).
