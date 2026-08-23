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
| swagger_snapshot_spec | 지금 스펙을 라벨 붙여 저장. 라벨 생략하면 목록 |
| swagger_diff_spec | 스냅샷 대비 뭐가 바뀌었는지, 호환성 깨지는 건 따로 |
| swagger_refresh_spec | 배포 직후 최신 스펙이 안 보일 때 캐시를 버린다 |

## 순서

찾기 → 상세 → 필요하면 호출. 스키마를 안 보고 swagger_call_api부터 부르지 마라.
바디 모양을 지어내게 된다.

경로는 swagger_list_endpoints가 준 형태 그대로 넣는다 (/api/v1/users/{userId}).

## API를 실제로 호출할 때

swagger_call_api는 dev에 진짜 요청을 보낸다. 인증이 필요한 API는 JWT를 token 인자로 넘긴다.
401이 오면 토큰이 없거나 만료된 것이다. 이 서버에는 로그인 기능이 없으므로 토큰은 밖에서 받아온다.

쓰기 메서드(POST/PUT/PATCH/DELETE)는 기본으로 막혀 있다. 막히면 사용자에게 알리고 멈춰라.
도구 인자로는 열 수 없다 — 서버 운영자가 설정에 넣어야 하는 스위치다.

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
