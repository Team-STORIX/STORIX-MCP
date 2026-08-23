// 연결된 클라이언트에게 슬래시 커맨드로 내려가는 사용 안내.
// 설치·등록은 여기 담지 않는다. 이 글이 보인다는 건 이미 연결됐다는 뜻이다.
export const GUIDE = `STORIX MCP의 swagger 모듈로 dev 서버(https://dev.storix.kr)의 API 스펙을 다룬다.

## 툴

| 툴 | 쓸 때 |
|---|---|
| swagger_list_endpoints | 어떤 API가 있는지 찾는다. keyword/tag/method 필터 |
| swagger_get_endpoint | 그 API의 요청·응답 스키마를 $ref까지 펼쳐서 본다 |
| swagger_get_schema | DTO 하나를 이름으로 본다. 이름 생략하면 전체 목록 |
| swagger_call_api | dev에 진짜 요청을 보낸다 |
| swagger_errors | 이 API가 내는 에러 코드만. code로 역방향 조회도 된다 |
| swagger_history | 배포 시점별로 언제 뭐가 바뀌었는지. tag/path로 좁힌다 |
| swagger_snapshot_spec | 지금 스펙을 라벨 붙여 저장. 라벨 생략하면 목록 |
| swagger_diff_spec | 스냅샷 대비 뭐가 바뀌었는지, 호환성 깨지는 건 따로 |
| swagger_refresh_spec | 배포 직후 최신 스펙이 안 보일 때 캐시를 버린다 |

## 순서

찾기 → 상세 → 필요하면 호출. 스키마를 안 보고 swagger_call_api부터 부르지 마라.
바디 모양을 지어내게 된다.

에러 분기만 짤 때는 swagger_get_endpoint 대신 swagger_errors 를 써라.
같은 엔드포인트가 7천 자에서 1천 자로 줄어든다. 스키마가 필요할 때만 get_endpoint 로 간다.

경로는 swagger_list_endpoints가 준 형태 그대로 넣는다 (/api/v1/users/{userId}).

## 내 코드의 에러 분기가 스펙과 맞는지 대조하기

MCP는 스펙만 안다. 코드는 네가 직접 읽어야 한다. 순서는 이렇다.

1. swagger_errors 를 인자 없이 불러 전체 코드 목록을 받는다 (117개 안팎, 7천 자 정도)
2. 코드베이스에서 에러 코드 문자열을 전부 grep 한다 (보통 "XXX_ERROR_001" 꼴)
3. 두 집합을 비교한다

  코드에는 있는데 스펙에 없음 - 죽은 분기. 서버가 그 코드를 더는 안 내보낸다
  스펙에는 있는데 코드에 없음 - 처리 안 된 에러. 사용자에게 기본 메시지만 뜬다

죽은 분기를 지우기 전에 swagger_errors {code} 로 한 번 더 확인해라.
이름이 바뀐 것일 수도 있고, 그렇다면 지우는 게 아니라 새 코드로 바꾸는 것이 맞다.

## API를 실제로 호출할 때

swagger_call_api는 dev에 진짜 요청을 보낸다. 로컬 모드라면 auth_login으로 로그인해 두면
토큰이 자동으로 붙고, 만료되면 알아서 재발급한다. 원격 모드에는 로그인이 없으니 token 인자로 직접 넘긴다.

쓰기 메서드(POST/PUT/PATCH/DELETE)는 기본으로 막혀 있다. 막히면 사용자에게 알리고 멈춰라.
도구 인자로는 열 수 없다 — 서버 운영자가 설정에 넣어야 하는 스위치다.

## "뭐 바뀌었어?" 에는 swagger_history

배포마다 찍힌 스냅샷을 이웃끼리 비교해 시간순으로 보여준다. 인자 없이 부르면 최근 배포 1건.

기능 단위로 물으면 tag를 쓴다 (부분 일치). 특정 API 하나면 path.
tag가 기본 탐색축이다 - 새로 생긴 엔드포인트는 경로를 모르니 path로는 찾을 수 없고,
경로가 바뀐 것도 태그로 묶어야 "제거 + 추가"가 나란히 보인다.

결과에 붙는 PR 번호·커밋은 출처 표시다. 더 알아볼 게 있으면 그걸로 백엔드에 물어보면 된다.

## 릴리스 전 스펙 비교

배포 전에 swagger_snapshot_spec으로 라벨을 찍어두고, 배포 후 swagger_diff_spec으로 비교한다.

breaking으로 분류하는 것: 엔드포인트·필드·응답 상태코드 제거, 필드 타입 변경,
필수 파라미터 추가, 요청 필드가 선택→필수, 응답 필드가 필수→선택, 응답이 nullable로 전환,
요청에서 enum 값 제거, 인증 요구 변경.

그 외로 빼는 것: 엔드포인트·필드 추가, enum 값 추가, format 변경, deprecated 표시,
반대 방향의 완화. 경로 변경은 rename을 못 알아보고 "제거 + 추가"로 나온다.
description·example 변경은 일부러 무시한다.

## 스펙이 옛날 것으로 보이면

캐시 TTL이 60초다. 배포 직후라면 swagger_refresh_spec으로 버리고 다시 받는다.`;
