# 환경변수

[← README](../README.md)

붙이는 방식과 쓰려는 모듈에 따라 필요한 것만 넣으면 된다.

## 공통 · swagger

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


## auth (로컬 전용)

| 변수 | 기본값 | 설명 |
|---|---|---|
| `STORIX_MCP_HOME` | 실행 디렉터리 | `.storix-mcp.json` 을 둘 위치 |

## report

| 변수 | 기본값 | 설명 |
|---|---|---|
| `STORIX_SLACK_WEBHOOK_URL` | (없음) | 없으면 보내지 않고 올릴 내용만 보여준다 |
| `STORIX_SLACK_CHANNEL` | `#오류-제보` | 표시용 채널명 |
| `STORIX_MCP_REPORTER` | (없음) | 제보자 이름. 툴 인자로도 넘길 수 있다 |

## metrics

| 변수 | 기본값 | 설명 |
|---|---|---|
| `STORIX_DB_HOST` / `STORIX_DB_PORT` | · `3306` | DB 주소 |
| `STORIX_DB_USER` / `STORIX_DB_PASSWORD` | (없음) | **읽기 전용 계정만 쓸 것** |
| `STORIX_DB_NAME` | (없음) | 스키마 이름 |
| `STORIX_DB_TIMEOUT_MS` | `5000` | 이 시간을 넘는 질의는 서버가 죽인다 |

## db

| 변수 | 기본값 | 설명 |
|---|---|---|
| (없음) | | RDS 주소 · 계정 · 스키마 이름은 Parameter Store `<STORIX_PARAM_PREFIX>/db/*` 에서 각자의 AWS 자격증명으로 읽는다. 따로 넣을 값이 없다 |
| `STORIX_READER_RDS_HOST` · `STORIX_READER_USER` · `STORIX_READER_PROD_DB` · `STORIX_READER_STAGING_DB` | (없음) | 넷 다 주면 Parameter Store 대신 이 값을 쓴다 |
| `STORIX_READER_HOST` / `STORIX_READER_PORT` | `127.0.0.1` · `13306` | 실제로 붙는 곳 (SSM 터널) |
| `STORIX_READER_TIMEOUT_MS` | `5000` | 연결 · 실행 시간 제한 |
| `AWS_REGION` | `ap-northeast-2` | IAM 토큰 리전. 자격증명은 AWS SDK 기본 규칙대로(AWS_PROFILE 포함) 읽는다 |

## flow

| 변수 | 기본값 | 설명 |
|---|---|---|
| `STORIX_FLOWS_DIR` | 저장소의 `flows/` | 시나리오를 둘 위치 |

## mobile (로컬 전용)

| 변수 | 기본값 | 설명 |
|---|---|---|
| `STORIX_APP_SCHEME` | `storixfe21` | 딥링크 스킴. FE 의 `app.json` 과 같아야 한다 |
| `STORIX_APP_IOS_BUNDLE_ID` | `kr.storix.app` | 시뮬레이터에 앱이 깔렸는지 볼 때 쓴다 |
| `STORIX_APP_ANDROID_PACKAGE` | `kr.storix.android` | 위와 같다 |

## dev_server (로컬 전용)

| 변수 | 기본값 | 설명 |
|---|---|---|
| `STORIX_DEV_INSTANCE_NAME` | `Dev Server` | dev 인스턴스의 Name 태그. Env 태그가 `dev` 인 것만 다룬다 |

EC2 는 각자 AWS 프로필로 부른다. 그 계정이 IAM `developers` 그룹에 들어 있어야 한다.

## HTTP 모드

| 변수 | 기본값 | 설명 |
|---|---|---|
| `MCP_PORT` | `8090` | 3000 은 프론트 dev 서버가 쓰므로 피했다 |
| `MCP_BASIC_USER` / `MCP_BASIC_PASSWORD` | `SWAGGER_*` 값 | 접속 계정 |
| `MCP_ALLOWED_ORIGINS` | (비어 있음) | 허용할 `Origin`, 쉼표 구분 |
