# STORIX MCP

STORIX 개발에 쓰는 도구들을 Claude 에 붙이는 MCP 서버.

API 스펙을 찾아 읽고, 배포마다 뭐가 바뀌었는지 되짚고, 에러가 났을 때 어느 쪽이
스펙과 어긋났는지 가리고, 지표를 조회한다. 스웨거 화면을 뒤지거나 DB 를 손으로 뽑던 일을
대화 중에 끝내려고 만들었다.

서버는 `storix` 하나이고 기능은 모듈로 나뉜다. 툴 이름이 `<모듈>_<기능>` 이라
이름만 보고 어느 모듈 것인지 안다.

| 모듈 | 하는 일 | 원격에서도 쓸 수 있나 |
|---|---|---|
| `swagger` | 스펙 조회, 에러 코드, 배포별 변경 이력, 실제 호출 | 예 |
| `report` | 어긋난 곳 판정, 슬랙 제보 | 예 |
| `metrics` | 미리 정의한 집계 질의 | 예 |
| `auth` | 관리자·테스터 로그인, 토큰 관리 | **아니오, 로컬 전용** |
| `flow` | 사용자 흐름 시나리오를 API 로 돌리고 판정 | 예 |
| `mobile` | 앱 화면 띄우기, Maestro 안내 | **아니오, 로컬 전용** |

빌드 단계가 없다. Node 18+ 만 있으면 된다.

---

## 붙이기

### 로컬 — 개발자

패키지로 받아 쓰는 게 가장 간단하다. 클론도 설치도 필요 없다.

```bash
claude mcp add storix -- npx -y @team-storix/storix-mcp@latest
```

자격증명은 각자 넣는다. `SWAGGER_USER` 를 넣거나, AWS 프로필만 주고 Parameter Store 에서 읽게 한다.
버킷까지 같이 주면 팀이 공유하는 배포 이력(`swagger_history` · `swagger_diff_spec`)도 잡힌다.

```jsonc
{
  "env": {
    "AWS_PROFILE": "storix",
    "SWAGGER_SNAPSHOT_S3_BUCKET": "storix-2.0-besfeyc-3o8dxghk"
  }
}
```

저장소를 받아서 각자 등록한다. 로컬 모드에서는 모든 모듈이 켜진다.

```bash
git clone https://github.com/Team-STORIX/STORIX-MCP.git
cd STORIX-MCP && npm install

claude mcp add storix --scope user \
  -e SWAGGER_BASE_URL=https://dev.storix.kr \
  -e SWAGGER_USER='<계정 — 팀 시크릿 참고>' \
  -e SWAGGER_PASSWORD='<비밀번호 — 팀 시크릿 참고>' \
  -- node "$PWD/src/index.js"
```

등록 후 **Claude Code 를 재시작해야** 툴이 잡힌다. `claude mcp list` 에 `✔ Connected` 가
뜨면 된 것이다.

`--scope user` 는 어느 디렉터리에서 작업하든 잡히게 한다. `claude mcp list` 는 현재
디렉터리 기준이라, 프로젝트 스코프로 넣으면 그 프로젝트 밖에서는 아예 안 보인다.
`--scope project` 는 `.mcp.json` 을 저장소에 만들어 커밋되므로 쓰지 마라.

### 원격 — 클론 없이 URL 만

`src/http.js` 를 띄우면 `/mcp` 하나로 서비스된다. 받는 쪽은 URL 만 등록하면 된다.

```bash
claude mcp add --transport http storix https://<주소>/mcp \
  --header "Authorization: Basic $(printf '%s' '<계정>:<비밀번호>' | base64)"
```

**아직 배포 전이다.** 배포되면 이 방식이 기본이 된다. 이때 `auth` 모듈은 자동으로
꺼진다 — 아래 [로컬 전용인 것](#로컬-전용인-것과-그-이유) 참고.

---

## 환경변수

붙이는 방식과 쓰려는 모듈에 따라 필요한 것만 넣으면 된다.

**공통 · swagger**

| 변수 | 기본값 | 설명 |
|---|---|---|
| `SWAGGER_BASE_URL` | `https://dev.storix.kr` | 대상 서버 |
| `SWAGGER_SPEC_PATH` | `/v3/api-docs` | OpenAPI 문서 경로 |
| `SWAGGER_USER` / `SWAGGER_PASSWORD` | (없음) | 스펙 조회용 basic auth. 없으면 Parameter Store 에서 읽는다 |
| `STORIX_PARAM_PREFIX` | `/storix/dev` | 자격증명을 둔 Parameter Store 경로 앞부분 |
| `AWS_REGION` | `ap-northeast-2` | Parameter Store 를 읽을 리전 |
| `SWAGGER_CACHE_TTL_MS` | `60000` | 스펙 캐시 유효시간 |
| `SWAGGER_SNAPSHOT_DIR` | `~/.storix-mcp/swagger/snapshots` | `fs` 백엔드의 스냅샷 저장 위치. **컨테이너로 띄우면 볼륨으로 빼라.** 안 그러면 재배포마다 변경 이력이 통째로 날아간다 |
| `SWAGGER_SNAPSHOT_S3_BUCKET` | (없음) | 넣으면 스냅샷을 S3 에서 읽는다. 팀이 공유하는 배포 이력이 여기 쌓이므로 `swagger_history` · `swagger_diff_spec` 을 쓰려면 필요하다 |
| `SWAGGER_SNAPSHOT_S3_PREFIX` | `swagger-snapshots` | 위 버킷 안의 경로 앞부분 |
| `SWAGGER_MCP_ALLOW_WRITE` | (꺼짐) | `true` 여야 `swagger_call_api` 가 POST/PUT/PATCH/DELETE 를 보낸다 |
| `STORIX_DEV_TOKEN` | (없음) | 호출에 붙일 JWT. `auth_login` 을 쓰면 필요 없다 |

자격증명을 Parameter Store 에 두면 `SWAGGER_USER` / `SWAGGER_PASSWORD` 를 적지 않아도 된다.
읽을 권한은 AWS 프로필(환경변수 AWS_PROFILE 또는 기본 프로필)로 정해지며,
IAM 에서 해당 파라미터 경로만 열어주면 된다.


**auth (로컬 전용)**

| 변수 | 기본값 | 설명 |
|---|---|---|
| `STORIX_MCP_HOME` | 실행 디렉터리 | `.storix-mcp.json` 을 둘 위치 |

**report**

| 변수 | 기본값 | 설명 |
|---|---|---|
| `STORIX_SLACK_WEBHOOK_URL` | (없음) | 없으면 보내지 않고 올릴 내용만 보여준다 |
| `STORIX_SLACK_CHANNEL` | `#오류-제보` | 표시용 채널명 |
| `STORIX_MCP_REPORTER` | (없음) | 제보자 이름. 툴 인자로도 넘길 수 있다 |

**metrics**

| 변수 | 기본값 | 설명 |
|---|---|---|
| `STORIX_DB_HOST` / `STORIX_DB_PORT` | · `3306` | DB 주소 |
| `STORIX_DB_USER` / `STORIX_DB_PASSWORD` | (없음) | **읽기 전용 계정만 쓸 것** |
| `STORIX_DB_NAME` | (없음) | 스키마 이름 |
| `STORIX_DB_TIMEOUT_MS` | `5000` | 이 시간을 넘는 질의는 서버가 죽인다 |

**flow**

| 변수 | 기본값 | 설명 |
|---|---|---|
| `STORIX_FLOWS_DIR` | 저장소의 `flows/` | 시나리오를 둘 위치 |

**mobile (로컬 전용)**

| 변수 | 기본값 | 설명 |
|---|---|---|
| `STORIX_APP_SCHEME` | `storixfe21` | 딥링크 스킴. FE 의 `app.json` 과 같아야 한다 |
| `STORIX_APP_IOS_BUNDLE_ID` | `kr.storix.app` | 시뮬레이터에 앱이 깔렸는지 볼 때 쓴다 |
| `STORIX_APP_ANDROID_PACKAGE` | `kr.storix.android` | 위와 같다 |

**HTTP 모드**

| 변수 | 기본값 | 설명 |
|---|---|---|
| `MCP_PORT` | `8090` | 3000 은 프론트 dev 서버가 쓰므로 피했다 |
| `MCP_BASIC_USER` / `MCP_BASIC_PASSWORD` | `SWAGGER_*` 값 | 접속 계정 |
| `MCP_ALLOWED_ORIGINS` | (비어 있음) | 허용할 `Origin`, 쉼표 구분 |

---

## 쓰기

툴 이름을 외울 필요는 없다. 말로 하면 Claude 가 고른다. 아래는 무슨 말을 하면
무엇이 도는지에 대한 안내다.

서버가 슬래시 커맨드도 같이 내려준다. 파일을 깔 필요 없이 연결만 하면 뜬다.

```
/mcp__storix__swagger    swagger 툴 쓰는 법
/mcp__storix__report     오류 제보 절차
```

### API 스펙 보기

> "토픽룸 생성 화면 만들 건데 API 스펙 좀"

`swagger_list_endpoints` 로 찾고 `swagger_get_endpoint` 로 요청·응답 스키마를
`$ref` 까지 펼쳐서 본다. 경로는 목록이 준 형태 그대로 쓴다.

스키마를 안 보고 `swagger_call_api` 부터 부르지 마라. 바디 모양을 지어내게 된다.

### 에러 코드만

> "이 API 에러 뭐 나와?"

`swagger_errors` 는 에러만 추린다. 같은 엔드포인트가 `swagger_get_endpoint` 로는
7천 자인데 여기서는 1천 자다. 에러 분기만 짤 때는 이쪽을 쓴다.

```
swagger_errors {method, path}           이 API 에러만
swagger_errors {tag: "토픽룸"}           기능 단위
swagger_errors {code: "USER_ERROR_007"}  이 코드가 어디서 나가는지 거꾸로
swagger_errors                           전체 목록
```

인증 공통 에러는 개별 API 응답에 안 실리고 문서 상단 표에만 있다.
`swagger_errors` 는 그것도 같이 붙여준다.

전체 목록은 **내 코드의 에러 분기와 대조**할 때 쓴다. 코드에는 있는데 스펙에 없으면
죽은 분기, 스펙에는 있는데 코드에 없으면 처리 안 된 에러다. 지우기 전에
`swagger_errors {code}` 로 이름만 바뀐 건 아닌지 확인해라.

### 뭐가 바뀌었나

> "어제 배포된 거 뭐 바뀌었어?"  "토픽룸 쪽 최근 변경 좀"

`swagger_history` 가 배포 시점마다 찍힌 스냅샷을 이웃끼리 비교해 시간순으로 보여준다.
인자 없이 부르면 최근 배포 1건.

```
swagger_history                     최근 배포
swagger_history {tag: "토픽룸"}      기능 단위
swagger_history {path}              엔드포인트 하나
swagger_history {since: "1w"}       기간
```

`tag` 가 기본 탐색축이다. **새로 생긴 엔드포인트는 경로를 모르니 `path` 로는 찾을 수 없고**,
경로가 바뀐 것도 태그로 묶어야 "제거 + 추가" 가 나란히 보인다.

```
8/22 14:03  PR #251 · 719c0d0 · 에러 스펙 추가
  + POST /api/v1/topic-rooms/{roomId}/pin  새 엔드포인트
  ~ POST /api/v1/topic-rooms
      [breaking] 응답 200 result 타입 변경: integer → string
```

결과에 붙는 PR 번호는 출처 표시다. 더 알아볼 게 있으면 그걸로 백엔드에 물어보면 된다.
스냅샷을 찍을 때 `pr`·`commit`·`title` 을 같이 넣으면 여기에 따라붙는다.

**스냅샷이 없으면 이력도 없다.** 배포마다 `swagger_snapshot_spec` 이 한 번 돌아야 쌓인다.

### 실제로 호출해보기

로컬이면 `auth_setup` 으로 계정을 한 번 넣고 `auth_login` 하면, 이후
`swagger_call_api` 가 토큰을 자동으로 붙이고 만료되면 알아서 재발급한다.

```
admin   auth_setup {as: "admin", email, password}   → auth_login
tester  auth_signup_tester {nickName, favoriteGenreList}
          → 슬랙에서 사람이 승인 (10분 안에)
          → auth_login {as: "tester"}
```

계정은 작업 중인 프로젝트의 `.storix-mcp.json` 에 저장되고 `.gitignore` 에 자동 등록된다.
토큰은 프로세스 메모리에만 두고 파일로 남기지 않는다.

테스터의 `pendingId` 는 승인 대기용 임시값이 아니라 **승인 후에도 계속 쓰는 로그인 키**다.
한 번 승인받으면 다른 컴퓨터에서도 `auth_setup {as: "tester", pendingId}` 로 바로 쓴다.

쓰기 메서드는 기본으로 막혀 있다. 열려면 서버 설정에 `SWAGGER_MCP_ALLOW_WRITE=true`
가 있어야 한다. 툴 인자로는 못 켠다 — 인자였으면 AI 가 스스로 켤 수 있어 관문이 못 된다.

### 오류 제보

> "이거 왜 안 되지"  "이거 누구 문제야"

`report_check` 가 스펙과 대조해 어느 쪽이 어긋났는지 가린다. 서로 넘겨짚기 전에 먼저 돌린다.

```
요청이 스펙과 다름                     프론트
응답·상태값·에러 코드가 스펙과 다름     백엔드
```

가리지 못하는 경우엔 단정하지 않는다 — 401/403 인증 문제, 문서화된 에러가 그대로 나온
경우(정상 동작일 수 있다), 스펙에 아예 없는 경로(미배포이거나 제거됐을 수 있다).

진짜 문제로 보이면 `report_send` 로 슬랙에 올린다. 형식이 고정돼 있어 채널에 같은 모양으로
쌓인다. 보내기 전에 `dryRun` 으로 내용을 확인받는 편이 낫다.

```
🔴  [백엔드]  POST /api/v1/topic-rooms
──────────────────────────────
[증상]  생성 누르면 400 뜨는데 코드가 처음 보는 거임
──────────────────────────────
[판정 근거]
  • [백엔드] TOPIC_ROOM_ERROR_099 는 스펙 어디에도 없는 코드입니다.
──────────────────────────────
```

판정이 "확인필요" 로 나와도 올릴 수 있다. 스펙으로 못 가린다는 뜻이지 문제가 없다는 뜻이 아니다.

### 지표

> "어제 가입자 몇 명이야?"  "출석 이벤트 참여율"

`metrics_list` 로 무엇을 셀 수 있는지 보고 `metrics_query` 로 돌린다.

```
signups        일별 가입자 (역할별)
withdrawals    일별 탈퇴
accounts       계정 상태 분포
active_users   일별 접속자
attendance     출석 이벤트 참여
story_card     오늘의 스토리 카드 참여
event_rate     이벤트별 참여율
```

**자유 SQL 은 받지 않는다.** 미리 정의한 집계만 나가므로 개인을 특정하는 값이 응답에
담기지 않는다. `users` 에는 비밀번호 해시와 이메일이 있다.

각 지표에는 해석 주의점이 붙어 있다. 예를 들어 `active_users` 는 마지막 로그인 시각
기준이라 정확한 DAU 가 아니고, `event_rate` 는 분모가 현재 계정 수라 과거 이벤트일수록
비율이 낮게 잡힌다. 숫자만 보고 판단하지 마라.

연결은 읽기 전용 세션·5초 타임아웃·락 대기 2초·조회 기간 180일 상한으로 묶여 있다.
**dev 와 운영이 같은 인스턴스를 스키마로만 나눠 쓰기 때문이다.** 여기 날린 질의가
운영 자원을 쓴다.

---

### 앱 흐름 돌려보기

사용자 흐름 한 벌을 `flows/<이름>.md` 에 적어두고, 같은 파일을 두 가지로 쓴다.
설명은 사람이 읽고 실행기는 yaml 블록만 본다. `api` 는 `flow` 가, `route` 는 `mobile` 이 쓴다.

    flow_list                     어떤 시나리오가 있나
    flow_check {name}             호출 없이 경로가 아직 스펙에 있는지만
    flow_run {name}               실제로 호출하고 스펙과 대조해 판정
    mobile_doctor                 지금 환경에서 어디까지 되나
    mobile_open {route}           앱에서 그 화면 띄우기

`flow_run` 은 `auth_login` 으로 받아둔 토큰을 쓴다. 앞 스텝에서 뽑은 값을 다음 스텝에 넣으므로
한 스텝이 실패하면 거기서 멈춘다. 쓰기 스텝은 `SWAGGER_MCP_ALLOW_WRITE` 가 꺼져 있으면 건너뛴다.

판정은 상태 코드, `has` 로 적은 필드가 있는지, 그리고 응답 최상위를 스펙과 대조해서 한다.
스펙의 필수 필드가 빠졌으면 실패, 스펙에 없는 필드가 오면 참고로만 적는다.

`mobile_open` 은 화면을 띄우기만 하고 버튼을 누르지는 못한다. 눌러야 하는 구간은 Maestro 를 쓴다.
Maestro 가 없어도 나머지는 그대로 된다. 자세한 건 `mobile` 프롬프트에 있다.

**앱을 띄우면 앱이 스스로 dev API 를 부른다.** 우리가 고른 요청만 나가는 게 아니라
analytics, 푸시 기기 등록, 미리 받아두기까지 따라 나가고 dev 데이터가 실제로 쌓인다.

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
| `fs` | 각자 찍어 보는 로컬 이력, 그리고 나중에 EFS 를 붙일 때 | 기본값 |
| `s3` | Lambda, 그리고 팀이 공유하는 배포 이력을 볼 때 | `SWAGGER_SNAPSHOT_S3_BUCKET` 이 있으면 |

EFS 도 결국 POSIX 마운트라 `fs` 백엔드가 그대로 동작한다. `SWAGGER_SNAPSHOT_DIR` 만 바꾸면 된다.

**이력은 CD 가 배포 때마다 S3 에 쌓는다.** 그래서 버킷을 주지 않으면 비어 있는 `fs` 를 보게 되고
`swagger_history` 는 "스냅샷이 없다"고 답한다. 읽기 권한은 AWS 프로필로 정해지며, 쓰기는 주지 않는다 —
스냅샷을 찍는 것은 CD 의 몫이다.

**스냅샷이 사라지면 직전 배포와 비교할 수가 없다.** 컨테이너로 띄운다면 반드시 볼륨으로 빼라.

---

## 각자 만든 MCP 붙이기

로컬에서 쓰는 다른 MCP 서버를 `storix` 하나에 묶을 수 있다. 등록을 여러 개로 늘리지 않고
한 자리에서 들고 있게 하려는 것이다.

`.storix-mcp.json` 에 `bridge` 를 넣는다. `auth_setup` 이 만드는 그 파일이다.

```jsonc
{
  "bridge": [
    { "alias": "notion", "command": "npx", "args": ["-y", "@notionhq/notion-mcp-server"] },
    { "alias": "mine", "command": "node", "args": ["/Users/me/tools/my-mcp/index.js"] }
  ]
}
```

툴은 `별칭_툴이름` 으로 올라온다. 위 예라면 `notion_search`, `mine_doctor` 처럼 된다.
무엇이 붙었는지는 `bridge_list` 로 본다.

**여기 적은 것은 npm 으로 나가지 않는다.** `.storix-mcp.json` 은 `.gitignore` 에 있고
`package.json` 의 `files` 는 `src` · `flows` · `skills` 만 싣는다. 각자 붙인 것이 패키지에
섞일 길이 없다.

몇 가지 정해둔 것:

- **로컬 전용이다.** 원격 HTTP 모드에서는 꺼진다 — 자식은 그 사람 컴퓨터에서 뜨는 프로세스다
- **자식이 죽어도 storix 는 뜬다.** 10초 안에 안 붙으면 건너뛰고 `bridge_list` 에 이유를 남긴다
  (`STORIX_BRIDGE_TIMEOUT_MS` 로 조절)
- **별칭이 `swagger` `auth` `report` `metrics` `mobile` `flow` 면 건너뛴다** — 이름이 겹친다
- **툴 목록은 세션 시작 때 정해진다.** 설정을 고쳤으면 Claude Code 를 다시 켜야 잡힌다

---

## 툴

| 툴 | 용도 |
|---|---|
| `swagger_list_endpoints` | 엔드포인트 찾기. `keyword`/`tag`/`method` 필터 |
| `swagger_get_endpoint` | 요청·응답 스키마를 `$ref` 까지 펼쳐서 |
| `swagger_get_schema` | DTO 하나. 이름 생략하면 전체 목록 |
| `swagger_errors` | 에러 코드만. `code` 로 역방향 조회 |
| `swagger_call_api` | 실제 요청 |
| `swagger_snapshot_spec` | 스펙 스냅샷 저장. 라벨 생략하면 목록 |
| `swagger_history` | 배포 시점별 변경 이력 |
| `swagger_diff_spec` | 두 스냅샷 비교 |
| `swagger_refresh_spec` | 캐시 버리고 재조회 |
| `report_check` | 어느 쪽이 어긋났는지 판정 |
| `report_send` | 판정을 붙여 슬랙에 제보 |
| `metrics_list` | 지표 목록과 해석 주의점 |
| `metrics_query` | 지표 조회 |
| `auth_setup` | 계정 저장 (로컬) |
| `auth_login` | 토큰 발급 (로컬) |
| `auth_signup_tester` | 테스터 가입 요청 (로컬) |
| `auth_status` | 로그인 상태 |
| `auth_logout` | 토큰 폐기 (로컬) |
| `flow_list` | 시나리오 목록 |
| `flow_check` | 호출 없이 경로가 스펙에 있는지만 |
| `flow_run` | 시나리오 실행과 판정 |
| `mobile_doctor` | 도구·기기 점검, 지금 되는 것 (로컬) |
| `mobile_open` | 딥링크로 앱 화면 띄우기 (로컬) |

---

## 로컬 전용인 것과 그 이유

`auth` 모듈은 원격(HTTP) 모드에서 `auth_status` 만 남기고 꺼진다.

공유 서버에 한 사람의 자격증명을 두면 **접속한 모두가 그 권한으로 API 를 호출**하게 된다.
그게 관리자 계정이면 아무나 제재를 걸 수 있다는 뜻이다. 원격에서 실제 호출이 필요하면
`swagger_call_api` 의 `token` 인자에 각자 자기 JWT 를 넘긴다.

`mobile` 은 원격에서 통째로 꺼진다. 기기를 만지는 일이라 그 사람 컴퓨터에서만 뜻이 있고,
공유 서버에서 남의 기기를 열 수 있게 둘 이유가 없다.

`metrics` 는 원격에서도 켜둔다. 미리 정의한 집계만 나가서 개인정보가 응답에 안 담기기
때문이다. 자유 SQL 을 열지 않은 이유가 여기에 있다.

### HTTP 모드 보안

- **basic auth** — `initialize` 부터 인증을 요구한다
- **Origin 검사** — DNS 리바인딩 방어. `Origin` 헤더가 있는데 허용 목록에 없으면 403.
  CLI 클라이언트는 `Origin` 을 안 보내므로 통과한다
- `Mcp-Session-Id` 는 인증에 쓸 수 없다. 서버가 `initialize` 응답으로 발급하는 값이라
  누구나 요청만 하면 받아간다. 세션은 상태 연속성용이지 자격증명이 아니다
- `/mcp/healthz` 만 인증 없이 200 (로드밸런서용)

스모크 검사는 `node smoke-http.mjs` — 무인증 401, 낯선 Origin 403, healthz 200,
툴 개수, 쓰기 차단을 확인한다.

---

## 한계

- **경로 변경은 rename 을 못 알아본다.** "제거 + 추가" 로 나온다. 태그로 묶어 보면 사람이 알아본다
- description·example 변경은 일부러 무시한다
- 스키마 펼치기는 기본 깊이 8 에서 자른다 (비교는 24 까지 본다). 순환 참조는 `$circular` 로 표시
- 태그 이름이 바뀌면 그 시점 앞뒤로 이력이 끊긴다. 스냅샷에 그때의 태그가 박히기 때문이다
- 응답 content-type 은 springdoc 이 `*/*` 로 내보내는 경우가 많아 json 우선, 없으면 첫 content 를 쓴다

`swagger_diff_spec` 이 breaking 으로 분류하는 것: 엔드포인트·필드·응답 상태코드 제거,
필드 타입 변경, 필수 파라미터 추가, 요청 필드가 선택→필수, 응답 필드가 필수→선택,
응답이 nullable 로 전환, 요청에서 enum 값 제거, 인증 요구 변경.

그 외로 빼는 것: 엔드포인트·필드 추가, enum 값 추가, format 변경, deprecated 표시,
반대 방향의 완화.

---

## 구조

```
src/
  index.js              stdio 진입점
  http.js               HTTP 진입점
  server.js             storix 서버 하나를 만들고 모듈을 등록
  shared/
    mcp.js              응답 헬퍼, 이름 접두사
    session.js          발급받은 토큰 (메모리)
  modules/
    index.js            등록할 모듈 목록
    swagger/            spec · diff · snapshots · history · errors · guide
    auth/               credentials
    report/             verdict · slack · guide
    metrics/            db · queries
```

모듈을 추가하려면 `src/modules/<이름>/index.js` 에 `NAMESPACE` 와
`register(server, { local })` 을 내보내고 `src/modules/index.js` 에 한 줄 넣는다.
`local` 이 false 면 여러 사람이 함께 쓰는 원격 모드다.
