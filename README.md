# STORIX MCP

STORIX 내부 도구를 Claude에 붙이는 MCP 서버. 서버는 `storix` 하나이고, 기능은 모듈로 나뉜다.
툴 이름은 `<모듈>_<기능>` 형태라 어느 모듈 것인지 이름만 봐도 안다.

| 모듈 | 하는 일 |
|---|---|
| `swagger` | dev 서버(`https://dev.storix.kr`)의 Swagger 스펙 조회·호출·버전 비교 |

빌드 단계 없이 Node로 바로 실행된다. Node 18+ 필요 (전역 `fetch` 사용).

## 구조

```
src/
  index.js              stdio 진입점
  http.js               HTTP 진입점
  server.js             storix 서버 하나를 만들고 모듈을 등록
  shared/mcp.js         응답 헬퍼, 이름 접두사
  modules/
    index.js            등록할 모듈 목록
    swagger/
      index.js          register(server) — swagger_* 툴
      spec.js           스펙 조회·캐시·$ref 펼치기
      diff.js           스냅샷·버전 비교
```

모듈을 추가하려면 `src/modules/<이름>/index.js`에 `NAMESPACE`와 `register(server)`를 내보내고
`src/modules/index.js`에 한 줄 넣는다.

## 설치

```bash
npm install
```

## 등록

```bash
claude mcp add storix --scope local \
  -e SWAGGER_BASE_URL=https://dev.storix.kr \
  -e SWAGGER_USER='<계정 — 팀 시크릿 참고>' \
  -e SWAGGER_PASSWORD='<Swagger 비밀번호 — 팀 시크릿 참고>' \
  -- node /절대경로/storix-mcp/src/index.js
```

`--scope local`이면 설정이 `~/.claude.json`에만 들어가서 저장소에 자격증명이 커밋되지 않는다.

## 환경변수

| 변수 | 기본값 | 설명 |
|---|---|---|
| `SWAGGER_BASE_URL` | `https://dev.storix.kr` | 대상 서버. 운영을 보려면 이 값만 바꾼다 |
| `SWAGGER_SPEC_PATH` | `/v3/api-docs` | OpenAPI 문서 경로 |
| `SWAGGER_USER` / `SWAGGER_PASSWORD` | (없음) | Swagger basic auth. `SecurityConfig`의 `swagger.user`/`swagger.password`와 같은 값 |
| `STORIX_DEV_TOKEN` | (없음) | `swagger_call_api`가 Bearer로 붙일 JWT |
| `SWAGGER_MCP_ALLOW_WRITE` | (꺼짐) | `true`면 `swagger_call_api`가 POST/PUT/PATCH/DELETE도 보낸다 |
| `MCP_PORT` | `8090` | HTTP 모드 포트. 3000은 프론트 dev 서버가 쓰므로 피했다 |
| `MCP_BASIC_USER` / `MCP_BASIC_PASSWORD` | `SWAGGER_USER`/`PASSWORD` 값 | HTTP 엔드포인트 basic auth 계정 |
| `MCP_ALLOWED_ORIGINS` | (비어 있음) | 허용할 `Origin` 목록, 쉼표 구분. 비면 브라우저 출처를 전부 거절 |
| `SWAGGER_CACHE_TTL_MS` | `60000` | 스펙 캐시 유효시간 |
| `SWAGGER_SNAPSHOT_DIR` | `~/.storix-mcp/swagger/snapshots` | diff용 스냅샷 저장 위치 |

## HTTP 모드 (프론트 배포용)

`src/http.js`를 띄우면 `/mcp` 하나로 서비스된다. 프론트는 클론 없이 URL만 등록하면 된다.

```bash
claude mcp add --transport http storix https://<주소>/mcp \
  --header "Authorization: Basic $(printf '%s' '<계정>:<비밀번호>' | base64)"
```

`/mcp/healthz`는 인증 없이 200을 반환한다 (로드밸런서 헬스체크용).

### 보안

- **basic auth** — Swagger와 같은 계정을 재사용한다. `initialize`부터 인증을 요구한다.
- **Origin 검사** — 스펙이 DNS 리바인딩 방어로 요구하는 항목. Origin 헤더가 있는데
  `MCP_ALLOWED_ORIGINS`에 없으면 403. CLI 클라이언트는 Origin을 안 보내므로 통과한다.
- `Mcp-Session-Id`는 인증에 쓸 수 없다. 서버가 `initialize` 응답으로 발급하는 값이라
  누구나 요청만 하면 받아갈 수 있어서 관문이 되지 못한다. 세션은 상태 연속성용이지 자격증명이 아니다.

## 툴 — swagger 모듈

| 툴 | 용도 |
|---|---|
| `swagger_list_endpoints` | 엔드포인트 목록. `keyword`/`tag`/`method`로 필터 |
| `swagger_get_endpoint` | 특정 API의 파라미터·요청·응답 스키마를 `$ref`까지 펼쳐서 반환 |
| `swagger_get_schema` | `components.schemas`의 DTO 조회. 이름 생략 시 전체 목록 |
| `swagger_call_api` | dev 서버에 실제 요청. 쓰기 메서드는 `SWAGGER_MCP_ALLOW_WRITE=true`일 때만 |
| `swagger_snapshot_spec` | 현재 스펙을 라벨 붙여 저장. 라벨 생략 시 목록 |
| `swagger_diff_spec` | 스냅샷 대비 변경 비교, 호환성 깨지는 변경을 따로 표시 |
| `swagger_refresh_spec` | 캐시 버리고 재조회 (배포 직후) |

## 릴리스 전 breaking change 점검

```
스냅샷 v2.4.2 저장해줘          → swagger_snapshot_spec
(배포 후)
v2.4.2 대비 뭐 바뀌었는지 봐줘   → swagger_diff_spec
```

`swagger_diff_spec`이 breaking으로 분류하는 것:

- 엔드포인트·파라미터·요청/응답 필드 제거, 응답 상태코드 제거
- 필드 타입 변경 (`string → integer`)
- 필수 파라미터 추가, 요청 필드가 선택 → 필수로 전환
- 응답 필드가 필수 → 선택으로 전환, 응답이 nullable로 전환
- 요청에서 enum 값 제거, 요청이 nullable을 안 받게 됨
- 인증 요구 변경

"그 외 변경"으로 빼는 것: 엔드포인트·필드 추가, enum 값 추가, format 변경, content-type 변경,
deprecated 표시, 반대 방향의 완화(요청이 선택으로 풀림 등).

아직 못 보는 것: 경로 변경은 rename이 아니라 "제거 + 추가"로 나온다. `$ref` 순환 아래와
펼침 깊이(24) 밖은 `…`으로 잘린다. description·example 변경은 의도적으로 무시한다.

## 주의

- `swagger_call_api`는 dev에 진짜 요청을 보낸다. 쓰기 메서드는 기본으로 막혀 있고, MCP 설정에
  `SWAGGER_MCP_ALLOW_WRITE=true`를 넣어야 열린다. 이 스위치를 도구 인자로 두지 않은 건 의도적이다 —
  인자로 두면 AI가 스스로 켤 수 있어서 관문 역할을 못 한다. 켜두면 AI가 dev 데이터를 실제로 변경할 수 있다.
- 응답 content-type은 springdoc이 `*/*`로 내보내는 경우가 많아 json 우선, 없으면 첫 content를 쓴다.
- 스키마 펼치기는 기본 깊이 8에서 자르고 (비교는 24까지 본다), 순환 참조는 `$circular`로 표시한다.
