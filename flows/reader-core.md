# 독자 기본 흐름

로그인한 독자가 프로필을 보고, 검색해서 작품에 들어가고, 리뷰와 알림까지 확인하는 경로.
쓰기는 하지 않아서 dev 데이터가 바뀌지 않는다.

`api` 는 `flow_run` 이, `route` 는 `mobile_open` 이 쓴다.

```yaml
steps:
  - name: 내 프로필
    api: GET /api/v2/profile/me
    has: [result.userId, result.nickName]
    capture: { nickName: result.nickName }
    route: profile

  - name: 오늘의 피드
    api: GET /api/v1/home/feeds/today
    has: [result]

  - name: 작품 검색
    api: GET /api/v2/search/works
    query: { keyword: "로맨스" }
    capture: { worksId: result.result.content.0.worksId, worksName: result.result.content.0.worksName }
    route: search

  - name: 작품 상세
    api: GET /api/v1/works/{worksId}
    has: [result.worksId, result.worksName]
    route: works/{worksId}

  - name: 리뷰 목록
    api: GET /api/v1/works/{worksId}/review
    has: [result]

  - name: 즐겨찾기 상태
    api: GET /api/v1/favorite/works/{worksId}
    has: [result]

  - name: 안 읽은 알림 수
    api: GET /api/v1/notifications/unread-count
    has: [result]
    route: notifications

  - name: 알림 설정
    api: GET /api/v1/notifications/settings
    has: [result]
    route: notifications/settings
```
