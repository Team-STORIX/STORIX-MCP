<h1>
<img src="https://github.com/user-attachments/assets/b65bf457-6754-4e0d-9d94-4511721b2b36" align=left width=100>
STORIX-MCP
</h1>

> 이야기에 대한 이야기로 모두가 연결되는 이 곳! 데이터로 취향을 연결하는 웹툰·웹소설 팬덤 플랫폼, STORIX

<br>

<img width="1920" height="1080" alt="STORIX Banner" src="https://github.com/user-attachments/assets/78d6f268-1e0a-43e9-a77f-c4cdc4d9dced" />

<h1><img src="https://github.com/user-attachments/assets/77539278-b8fc-40e2-85ac-f50340e5c417" width="25"/> STORIX MCP</h1>

![npm](https://img.shields.io/npm/v/@team-storix/storix-mcp?color=CB3837)
![Node](https://img.shields.io/badge/Node-18+-5FA04E)
![MCP SDK](https://img.shields.io/badge/MCP_SDK-1.12-000000)
![License](https://img.shields.io/badge/License-MIT-blue)

STORIX 개발에 쓰는 도구들을 Claude 에 붙이는 MCP 서버.

API 스펙을 찾아 읽고, 배포마다 뭐가 바뀌었는지 되짚고, 에러가 났을 때 어느 쪽이
스펙과 어긋났는지 가리고, 지표를 조회한다. 스웨거 화면을 뒤지거나 DB 를 손으로 뽑던 일을
대화 중에 끝내려고 만들었다.

빌드 단계가 없다. Node 18+ 만 있으면 된다.
## 🧩 모듈

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
| `db` | 운영 DB 읽기 전용 조회 (IAM 인증) | **아니오, 로컬 전용** |

전체 툴과 쓰는 법은 [쓰기](guide/usage.md) 에 있다.

## 🔌 붙이기

### 로컬

```bash
claude mcp add storix --scope user -- npx -y @team-storix/storix-mcp@latest
```

- 자격증명은 AWS 프로필만 주면 Parameter Store 에서 읽는다 (`-e AWS_PROFILE=storix`). `SWAGGER_USER` · `SWAGGER_PASSWORD` 를 직접 줘도 된다
- 팀이 공유하는 배포 이력(`swagger_history`)을 보려면 `SWAGGER_SNAPSHOT_S3_BUCKET` 도 준다 (팀 시크릿 참고)
- 등록 뒤 **Claude Code 를 다시 켜야** 툴이 잡힌다. `claude mcp list` 에 `✔ Connected` 면 된 것
- `--scope user` 로 넣는다. `--scope project` 는 `.mcp.json` 이 저장소에 커밋되므로 쓰지 않는다
- 저장소에서 바로 띄우려면 `git clone` · `npm install` 뒤 `-- node "$PWD/src/index.js"` 로 등록한다

### 원격 (아직 배포 전)

```bash
claude mcp add --transport http storix https://<주소>/mcp \
  --header "Authorization: Basic $(printf '%s' '<계정>:<비밀번호>' | base64)"
```

`src/http.js` 를 띄우면 `/mcp` 하나로 서비스된다. 원격에서는 `auth` · `mobile` · `dev_server` · `db` 가 꺼진다 ([이유](guide/security.md)).

## 📚 문서

| 문서 | 내용 |
|---|---|
| [쓰기](guide/usage.md) | 스펙 보기 · 에러 코드 · 변경 이력 · 실제 호출 · 오류 제보 · 지표 · 앱 흐름 · dev 서버 · 운영 DB · 툴 목록 · 한계 |
| [환경변수](guide/configuration.md) | 모듈별 환경변수와 기본값 |
| [로컬 전용인 것과 보안](guide/security.md) | 원격 모드에서 꺼지는 모듈과 그 이유, HTTP 모드 보안 |

## 🌐 서버 인프라

로컬에서는 각자의 Claude Code 가 `storix` 를 stdio 로 띄운다. 배포 파이프라인에 붙는 일은
Lambda 가 맡고, 자격증명과 배포 이력은 AWS 에 둔다.

```
개발자 PC — Claude Code
  └ storix (stdio)
      ├ swagger · report · flow ──▶ Parameter Store /storix/dev/*   스웨거 계정 (AWS 프로필로 읽기)
      ├ swagger_history ──────────▶ S3 swagger-snapshots/            배포마다 쌓인 스펙 (읽기 전용)
      ├ metrics ──────────────────▶ RDS                              읽기 전용 계정, 미리 정한 집계만
      └ dev_server ───────────────▶ EC2 Dev Server (Env=dev)         시작 · 연장 · 정지

STORIX-BE CD (develop 머지)
  └ lambda:InvokeFunction ──▶ Lambda storix-spec-changelog (VPC 밖)
                                └ 스펙 스냅샷 S3 저장 → 직전과 비교 → 슬랙 알림

매시 정각
  └ Lambda dev-server-auto-stop ──▶ 켠 지 4시간(배포가 켠 건 30분) 지난 dev 서버 끄기
```

| 워크플로 | 언제 | 하는 일 |
|---|---|---|
| `ci.yml` | PR, main push | 구문 검사와 기동 확인 |
| `lambda.yml` | main 에 `src/**` 변경 | `storix-spec-changelog` Lambda 코드 갱신 |
| `publish.yml` | GitHub Release 발행 | npm `@team-storix/storix-mcp` 배포 |

리소스를 만드는 명령은 `scripts/aws-setup.sh`, 자동 종료 Lambda 코드는 `scripts/dev-autostop-lambda.mjs` 에 있다.

## 📂 프로젝트 구조

```
STORIX-MCP/
  │
  ├── src/
  │   ├── index.js                # stdio 진입점 (npx 로 받는 것)
  │   ├── http.js                 # HTTP 진입점 (/mcp, basic auth)
  │   ├── cli.js                  # CD 용 snapshot · changelog
  │   ├── lambda.js               # storix-spec-changelog 핸들러
  │   ├── server.js               # storix 서버 하나를 만들고 모듈을 등록
  │   │
  │   ├── shared/                 # 응답 헬퍼, 토큰(메모리), Parameter Store, 마스킹
  │   │   └── store/              # 스냅샷 저장소 (fs · s3)
  │   │
  │   └── modules/
  │       ├── index.js            # 등록할 모듈 목록
  │       ├── swagger/            # spec · diff · snapshots · history · errors
  │       ├── report/             # verdict · slack
  │       ├── metrics/            # db · queries
  │       ├── auth/               # credentials (로컬 전용)
  │       ├── flow/               # 시나리오 실행 · judge
  │       ├── mobile/             # 딥링크 · 기기 점검 (로컬 전용)
  │       ├── devserver/          # EC2 시작 · 연장 · 정지 (로컬 전용)
  │       ├── db/                 # 운영 DB 읽기 전용 조회 · SQL 검사 (로컬 전용)
  │       └── bridge/             # 각자 만든 MCP 묶기 (로컬 전용)
  │
  ├── guide/                      # 쓰기 · 환경변수 · 보안 문서
  ├── flows/                      # 사용자 흐름 시나리오 (*.md)
  ├── skills/storix-mcp/          # Claude 스킬
  └── scripts/                    # AWS 리소스 생성, 자동 종료 Lambda
```

- 진입점과 모듈
  ```
  index.js (stdio, local=true)  ─┐
                                 ├→ server.js → modules/index.js → 각 모듈 register()
  http.js  (HTTP,  local=false) ─┘
  cli.js · lambda.js ──────────────→ modules/swagger (같은 diff 로 판정)
  ```

모듈을 추가하려면 `src/modules/<이름>/index.js` 에 `NAMESPACE` 와
`register(server, { local })` 을 내보내고 `src/modules/index.js` 에 한 줄 넣는다.
`local` 이 false 면 여러 사람이 함께 쓰는 원격 모드다.

## 🛠️ Developer
<table>
    <tr>
        <td align="center" width="160"><B>Lead·Backend</B></td>
        <td rowspan="4">
            <ul>
                <li><B>배포마다 스펙 변경 알림</B>
                    <ul>
                        <li>Lambda · CLI 로 배포마다 스펙 스냅샷을 비교해 슬랙으로 — <a href="https://github.com/Team-STORIX/STORIX-MCP/pull/4">#4</a></li>
                        <li>breaking 분류 재정의 · 에러 코드 · STOMP 계약 비교 — <a href="https://github.com/Team-STORIX/STORIX-MCP/pull/34">#34</a> · <a href="https://github.com/Team-STORIX/STORIX-MCP/pull/48">#48</a> · <a href="https://github.com/Team-STORIX/STORIX-MCP/pull/50">#50</a></li>
                        <li>작업자 표시 · 내부 API 분리 · 재발송 — <a href="https://github.com/Team-STORIX/STORIX-MCP/pull/46">#46</a> · <a href="https://github.com/Team-STORIX/STORIX-MCP/pull/62">#62</a> · <a href="https://github.com/Team-STORIX/STORIX-MCP/pull/51">#51</a></li>
                    </ul>
                </li>
                <li><B>개발 도구 모듈</B>
                    <ul>
                        <li>운영 DB 읽기 전용 조회 (IAM 인증 · 전체 스캔 거부) — <a href="https://github.com/Team-STORIX/STORIX-MCP/pull/68">#68</a> · <a href="https://github.com/Team-STORIX/STORIX-MCP/pull/71">#71</a> · <a href="https://github.com/Team-STORIX/STORIX-MCP/pull/72">#72</a></li>
                        <li>dev 서버 상태 · 시작 · 연장 · 정지, 배포로 켜진 서버는 짧게 — <a href="https://github.com/Team-STORIX/STORIX-MCP/pull/53">#53</a> · <a href="https://github.com/Team-STORIX/STORIX-MCP/pull/57">#57</a></li>
                        <li>시나리오 API 검증 · 딥링크 화면 확인 — <a href="https://github.com/Team-STORIX/STORIX-MCP/pull/2">#2</a></li>
                        <li>각자 만든 MCP 를 하나로 묶는 브리지 — <a href="https://github.com/Team-STORIX/STORIX-MCP/pull/30">#30</a></li>
                    </ul>
                </li>
                <li><B>보안 · 자격증명</B>
                    <ul>
                        <li>스웨거 · 로그인 계정을 Parameter Store 에서 — <a href="https://github.com/Team-STORIX/STORIX-MCP/pull/6">#6</a> · <a href="https://github.com/Team-STORIX/STORIX-MCP/pull/79">#79</a> · <a href="https://github.com/Team-STORIX/STORIX-MCP/pull/84">#84</a></li>
                        <li>공개 저장소에 운영 값이 들어오면 막는 검사 — <a href="https://github.com/Team-STORIX/STORIX-MCP/pull/78">#78</a> · <a href="https://github.com/Team-STORIX/STORIX-MCP/pull/49">#49</a> · <a href="https://github.com/Team-STORIX/STORIX-MCP/pull/75">#75</a></li>
                    </ul>
                </li>
                <li><B>배포</B>
                    <ul>
                        <li>npm 공개 배포 (조직 스코프 · Trusted Publishing) — <a href="https://github.com/Team-STORIX/STORIX-MCP/pull/12">#12</a> · <a href="https://github.com/Team-STORIX/STORIX-MCP/pull/20">#20</a> · <a href="https://github.com/Team-STORIX/STORIX-MCP/pull/22">#22</a></li>
                        <li>Lambda 코드 갱신 자동화 — <a href="https://github.com/Team-STORIX/STORIX-MCP/pull/8">#8</a> · <a href="https://github.com/Team-STORIX/STORIX-MCP/pull/10">#10</a> · <a href="https://github.com/Team-STORIX/STORIX-MCP/pull/16">#16</a></li>
                    </ul>
                </li>
            </ul>
        </td>
    </tr>
    <tr>
        <td align="center"><B>이수아</B></td>
    </tr>
    <tr>
        <td align="center"><img src="https://github.com/Immmii.png?size=100" width="100"></td>
    </tr>
    <tr>
        <td align="center"><a href="https://github.com/Immmii"><I>Immmii</I></a></td>
    </tr>
</table>
