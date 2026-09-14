export const GUIDE = `# 앱으로 확인하기

화면을 띄우는 방법이 두 가지다. 목적에 맞는 쪽을 쓴다.

## 딥링크 — 화면 이동만

\`mobile_open\` 이 앱에 URL 을 쏴서 해당 화면을 띄운다. 설치할 게 없고 잘 안 깨진다.
라우트는 FE 의 \`app/\` 파일 구조 그대로다. \`(tabs)\` 처럼 괄호로 묶인 그룹은 주소에 안 나온다.

    works/123        작품 상세
    search           검색
    notifications    알림함
    feed/456         피드 글
    library          서재 탭

버튼을 누르거나 글자를 넣지는 못한다. 로그인처럼 눌러야만 되는 건 아래를 쓴다.

## Maestro — 실제 조작

없어도 딥링크와 API 검증은 그대로 된다. 필요할 때만 깔면 된다.

    curl -Ls "https://get.maestro.mobile.dev" | bash

플로우는 YAML 로 쓰고 FE 저장소의 \`.maestro/\` 에 둔다. Maestro 표준 위치다.

    appId: kr.storix.app
    ---
    - launchApp
    - tapOn: "검색"
    - inputText: "작품명"
    - assertVisible: "리뷰"

### 플로우를 대신 써줄 때 지킬 것

사용자가 말로 흐름을 적으면 대신 YAML 을 쓴다. 다만 화면에 실제로 뭐가 있는지 모르는 채로
쓰면 거의 틀린다. 순서를 지킨다.

1. FE 의 \`app/\` 라우트와 화면 컴포넌트의 문구를 읽고 초안을 쓴다
2. \`maestro hierarchy\` 로 지금 떠 있는 화면의 실제 요소를 확인해 셀렉터를 맞춘다
3. \`maestro test <파일>\` 로 돌린다
4. 실패하면 2번으로 돌아간다
5. **통과한 것만 저장한다.** 돌려보지 않은 YAML 은 남기지 않는다

지금 FE 에는 \`testID\` 가 없어서 화면에 보이는 문구로 요소를 잡는다. 문구가 바뀌면 깨지므로
자주 쓰는 버튼에는 \`testID\` 를 붙여두는 편이 낫다. 이건 FE 쪽에서 정할 일이라 권하기만 한다.

## 주의

앱을 띄우면 앱이 스스로 dev API 를 부른다. 우리가 고른 요청만 나가는 게 아니라
analytics, 푸시 기기 등록, 미리 받아두기까지 따라 나간다. dev 데이터가 실제로 쌓인다.
`;
