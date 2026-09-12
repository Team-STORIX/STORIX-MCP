# STORIX MCP

STORIX 내부 도구를 Claude에 붙이는 MCP 서버. 서버는 `storix` 하나이고, 기능은 모듈로 나뉜다.
툴 이름은 `<모듈>_<기능>` 형태라 어느 모듈 것인지 이름만 봐도 안다.

| 모듈 | 하는 일 |
|---|---|
| `swagger` | dev 서버(`https://dev.storix.kr`)의 Swagger 스펙 조회·호출·버전 비교 |
| `auth` | 관리자·테스터 계정으로 로그인해 API 호출에 쓸 토큰을 관리 (로컬 모드 전용) |

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
      diff.js           두 스펙 비교
      snapshots.js      스냅샷 저장·색인
      history.js        배포 시점별 변경 이력
      guide.js          슬래시 커맨드로 내려가는 사용 안내
    auth/
      index.js          register(server) — auth_* 툴
      credentials.js    자격증명 파일과 .gitignore
```

모듈을 추가하려면 `src/modules/<이름>/index.js`에 `NAMESPACE`와 `register(server, { local })`를 내보내고
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
| `STORIX_DEV_TOKEN` | (없음) | `swagger_call_api`가 Bearer로 붙일 JWT. `auth_login`을 쓰면 필요 없다 |
| `STORIX_MCP_HOME` | 실행 디렉터리 | `.storix-mcp.json`을 둘 위치 |
| `SWAGGER_MCP_ALLOW_WRITE` | (꺼짐) | `true`면 `swagger_call_api`가 POST/PUT/PATCH/DELETE도 보낸다 |
| `MCP_PORT` | `8090` | HTTP 모드 포트. 3000은 프론트 dev 서버가 쓰므로 피했다 |
| `MCP_BASIC_USER` / `MCP_BASIC_PASSWORD` | `SWAGGER_*` 값 | HTTP 엔드포인트 basic auth 계정 |
| `MCP_ALLOWED_ORIGINS` | (비어 있음) | 허용할 `Origin` 목록, 쉼표 구분. 비면 브라우저 출처를 전부 거절 |
| `SWAGGER_CACHE_TTL_MS` | `60000` | 스펙 캐시 유효시간 |
| `SWAGGER_SNAPSHOT_S3_BUCKET` | (없음) | 있으면 스냅샷을 S3 에 둔다. Lambda 가 쓴다 |
| `SWAGGER_SNAPSHOT_S3_PREFIX` | `swagger-snapshots` | 그 버킷 안에서 쓸 경로 |
| `SWAGGER_SNAPSHOT_DIR` | `~/.storix-mcp/swagger/snapshots` | 스냅샷 저장 위치. 컨테이너로 띄우면 볼륨으로 빼야 재배포에 살아남는다 |

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

### 배포마다 스펙 변경 알리기

CD 에서 부를 수 있게 진입점을 둘 뒀다. MCP 서버와 같은 모듈을 쓰므로 판정이 갈라지지 않는다.

    node src/cli.js snapshot  --label v2.4.2
    node src/cli.js changelog --label "dev-abc1234" --commit "$SHA"

`changelog` 는 지금 스펙을 뜨고 **직전 스냅샷과 비교해** 변경 내역을 출력한다.
`STORIX_SLACK_WEBHOOK_URL` 이 있으면 슬랙으로도 보낸다. 첫 실행이라 비교 대상이 없으면
기준점만 잡고 끝낸다.

기본은 알리기만 하고 종료코드 0 으로 끝난다. dev 는 배포가 잦아 breaking 마다 실패시키면
금방 무시하게 되기 때문이다. 막고 싶으면 `--fail-on-breaking` 을 붙인다.

배포 파이프라인에서는 같은 일을 Lambda(`src/lambda.js`)가 한다. dev EC2 를 더 줄일 계획이라
그 서버의 메모리를 잠깐이라도 쓰지 않게 떼어냈다. **VPC 밖에 두므로 NAT 도 EIP 도 필요 없다.**

    aws lambda invoke --function-name storix-spec-changelog \
      --payload '{"label":"dev-abc1234","commit":"<sha>"}' /dev/null

Lambda 는 호출 주소가 따로 생기지 않는다. `lambda:InvokeFunction` 권한을 가진 주체만 부를 수 있고,
배포 역할 하나로 좁혀 둔다. **Function URL 은 만들지 않는다** — 만드는 순간 공개 엔드포인트가 된다.
리소스를 만드는 명령은 `scripts/aws-setup.sh` 에 모아 뒀다.

### 스냅샷을 어디에 두나

바이트를 읽고 쓰는 부분만 백엔드로 갈라 뒀다. 라벨 규칙과 색인 병합은 그대로다.

| 백엔드 | 언제 | 고르는 법 |
|---|---|---|
| `fs` | 로컬, 그리고 나중에 EFS 를 붙일 때 | 기본값 |
| `s3` | Lambda | `SWAGGER_SNAPSHOT_S3_BUCKET` 이 있으면 |

EFS 도 결국 POSIX 마운트라 `fs` 백엔드가 그대로 동작한다. `SWAGGER_SNAPSHOT_DIR` 만 바꾸면 된다.
S3 클라이언트는 Lambda 런타임에 들어 있어 의존성으로 넣지 않았고, `s3` 를 고를 때만 불러온다.

**스냅샷이 사라지면 직전 배포와 비교할 수가 없다.** 컨테이너로 띄운다면 반드시 볼륨으로 빼라.

---

## 툴 — auth 모듈

로컬(stdio) 모드에서만 켜진다. 여러 사람이 쓰는 원격 모드에서는 한 사람의 자격증명으로
모두가 호출하게 되므로 `auth_status`만 남고 나머지는 꺼진다.

| 툴 | 쓸 때 |
|---|---|
| `auth_setup` | 계정을 `.storix-mcp.json`에 저장하고 `.gitignore`에 등록 |
| `auth_login` | 저장된 계정으로 토큰 발급. 이후 `swagger_call_api`가 자동으로 씀 |
| `auth_signup_tester` | 테스터 가입 요청 → pendingId 발급·저장 (슬랙 승인 필요) |
| `auth_status` | 지금 누구로 로그인했는지, 토큰 얼마 남았는지 |
| `auth_logout` | 토큰 폐기. 저장된 계정은 남음 |

```
admin   auth_setup {as: "admin", email, password}     → auth_login
tester  auth_signup_tester {nickName, ...}            → 슬랙 승인 → auth_login
        (이미 pendingId가 있으면 auth_setup {as: "tester", pendingId})
```

테스터의 `pendingId`는 승인 대기용 임시값이 아니라 **승인 후에도 계속 쓰는 로그인 키**다.
승인되면 그대로 유저의 `oid`가 된다. 승인 기한 10분은 대기 레코드에만 걸린다.

자격증명은 `.storix-mcp.json`(작업 중인 프로젝트 폴더)에, 발급받은 토큰은 프로세스 메모리에만 둔다.
토큰은 디스크에 쓰지 않는다. `accessToken`이 만료되면 `refreshToken`으로 자동 재발급하고,
재발급도 실패하면 세션을 버린다.

## 툴 — swagger 모듈

| 툴 | 용도 |
|---|---|
| `swagger_list_endpoints` | 엔드포인트 목록. `keyword`/`tag`/`method`로 필터 |
| `swagger_get_endpoint` | 특정 API의 파라미터·요청·응답 스키마를 `$ref`까지 펼쳐서 반환 |
| `swagger_get_schema` | `components.schemas`의 DTO 조회. 이름 생략 시 전체 목록 |
| `swagger_errors` | 에러 코드만 추림. `code`로 역방향 조회, 인자 없으면 전체 목록 |
| `swagger_call_api` | dev 서버에 실제 요청. 쓰기 메서드는 `SWAGGER_MCP_ALLOW_WRITE=true`일 때만 |
| `swagger_snapshot_spec` | 현재 스펙을 라벨 붙여 저장. 라벨 생략 시 목록 |
| `swagger_history` | 배포 시점별로 언제 뭐가 바뀌었는지. `tag`·`path`로 좁힘 |
| `swagger_diff_spec` | 스냅샷 대비 변경 비교, 호환성 깨지는 변경을 따로 표시 |
| `swagger_refresh_spec` | 캐시 버리고 재조회 (배포 직후) |

## 에러 코드

`swagger_get_endpoint`는 스키마까지 통째로 준다. 에러 분기만 짤 거면 `swagger_errors`가 짧다.
같은 엔드포인트가 7,178자에서 1,033자가 된다.

```
이 API 에러 뭐 나와?        → swagger_errors {method, path}
토픽룸 쪽 에러 전부         → swagger_errors {tag: "토픽룸"}
이 코드 어디서 나와?        → swagger_errors {code: "USER_ERROR_007"}
전체 목록                   → swagger_errors
```

인증 공통 에러는 개별 API 응답에 실리지 않고 `info.description`의 표에만 있다.
`swagger_errors`는 그것도 같이 붙여서 준다.

전체 목록(117개, 7천 자)은 **프론트 코드의 에러 분기와 대조**할 때 쓴다. 코드 대조를 MCP 툴로 만들지
않은 건 원격 모드에서 서버가 클라이언트 파일을 못 읽기 때문이다. 목록은 MCP가 주고, grep은 에이전트가 한다.

## 변경 이력

배포마다 스냅샷을 찍어두면 `swagger_history`가 이웃 스냅샷을 비교해 "언제 무엇이 바뀌었는지"를 만든다.

```
뭐 바뀌었어?              → swagger_history            (최근 배포 1건)
토픽룸 쪽 뭐 바뀌었어?     → swagger_history {tag}      (기능 단위)
이 API 이력 좀            → swagger_history {path}     (엔드포인트 하나)
지난주부터                → swagger_history {since: "1w"}
```

`tag`가 탐색축이다. 새로 생긴 엔드포인트는 경로를 모르니 `path`로는 찾을 수 없고,
경로가 바뀐 경우도 태그로 묶어야 "제거 + 추가"가 나란히 보인다.

스냅샷을 찍을 때 `pr`·`commit`·`title`을 같이 넣으면 이력에 근거로 따라붙는다.
프론트가 PR 번호로 검색하는 게 아니라, 결과에서 출처를 보고 백엔드에 물어볼 실마리를 얻는 용도다.

```
8/22 14:03  PR #251 · 719c0d0 · 에러 스펙 추가
  + POST /api/v1/topic-rooms/{roomId}/pin  새 엔드포인트
  ~ POST /api/v1/topic-rooms
      [breaking] 응답 200 result 타입 변경: integer → string
```

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
