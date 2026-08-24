// 미리 정의한 질의만 나간다. 전부 집계라 개인을 특정하는 값이 응답에 담기지 않는다.
// 자유 SQL 을 열지 않은 이유가 이것이다 - users 에는 비밀번호 해시와 이메일이 있다.

export const MAX_DAYS = 180;

export const QUERIES = {
  signups: {
    title: "일별 가입자",
    description: "가입일 기준 신규 가입자 수를 역할별로 센다. 탈퇴한 계정도 가입 시점 기준으로 포함한다.",
    sql: `
      SELECT DATE(created_at) AS \`날짜\`,
             role AS \`역할\`,
             COUNT(*) AS \`가입자\`
        FROM users
       WHERE created_at >= ? AND created_at < ?
       GROUP BY DATE(created_at), role
       ORDER BY \`날짜\` DESC, \`역할\``,
  },

  withdrawals: {
    title: "일별 탈퇴",
    description: "탈퇴 처리된 계정 수를 날짜별로 센다.",
    sql: `
      SELECT DATE(deleted_at) AS \`날짜\`,
             COUNT(*) AS \`탈퇴\`
        FROM users
       WHERE deleted_at IS NOT NULL
         AND deleted_at >= ? AND deleted_at < ?
       GROUP BY DATE(deleted_at)
       ORDER BY \`날짜\` DESC`,
  },

  accounts: {
    title: "계정 상태 분포",
    description: "지금 시점의 계정 상태와 역할 분포. 기간 인자는 무시한다.",
    sql: `
      SELECT account_state AS \`상태\`,
             role AS \`역할\`,
             COUNT(*) AS \`인원\`
        FROM users
       GROUP BY account_state, role
       ORDER BY \`인원\` DESC`,
    ignoresPeriod: true,
  },

  active_users: {
    title: "일별 접속자",
    description: "마지막 로그인 시각 기준이라 하루에 여러 번 접속해도 한 번으로 센다. 정확한 DAU 가 아니다.",
    sql: `
      SELECT DATE(last_login_at) AS \`날짜\`,
             COUNT(*) AS \`접속자\`
        FROM users
       WHERE last_login_at >= ? AND last_login_at < ?
       GROUP BY DATE(last_login_at)
       ORDER BY \`날짜\` DESC`,
  },

  attendance: {
    title: "출석 이벤트 참여",
    description: "출석 체크 이벤트의 일별 참여자 수. 이벤트별로 나눠서 센다.",
    sql: `
      SELECT c.attended_on AS \`날짜\`,
             e.name AS \`이벤트\`,
             COUNT(DISTINCT c.user_id) AS \`참여자\`
        FROM event_attendance_checks c
        JOIN app_events e ON e.app_event_id = c.app_event_id
       WHERE c.attended_on >= ? AND c.attended_on < ?
       GROUP BY c.attended_on, e.name
       ORDER BY \`날짜\` DESC`,
  },

  story_card: {
    title: "오늘의 스토리 카드 참여",
    description: "스토리 카드를 뽑은 사람 수를 일별·장르별로 센다.",
    sql: `
      SELECT d.drawn_on AS \`날짜\`,
             d.genre AS \`장르\`,
             COUNT(DISTINCT d.user_id) AS \`참여자\`
        FROM event_story_card_draws d
       WHERE d.drawn_on >= ? AND d.drawn_on < ?
       GROUP BY d.drawn_on, d.genre
       ORDER BY \`날짜\` DESC, \`참여자\` DESC`,
  },

  event_rate: {
    title: "이벤트별 참여율",
    description:
      "진행됐거나 진행 중인 이벤트의 참여 인원과, 그 시점 정상 계정 대비 비율. " +
      "분모가 현재 계정 수라 과거 이벤트일수록 비율이 낮게 잡힌다.",
    sql: `
      SELECT e.name AS \`이벤트\`,
             e.event_type AS \`종류\`,
             DATE(e.start_at) AS \`시작\`,
             DATE(e.end_at) AS \`종료\`,
             COUNT(DISTINCT c.user_id) AS \`참여자\`,
             ROUND(COUNT(DISTINCT c.user_id) * 100
                   / NULLIF((SELECT COUNT(*) FROM users WHERE account_state = 'NORMAL'), 0), 1) AS \`참여율%\`
        FROM app_events e
        LEFT JOIN event_attendance_checks c ON c.app_event_id = e.app_event_id
       WHERE e.start_at < ?
       GROUP BY e.app_event_id, e.name, e.event_type, e.start_at, e.end_at
       ORDER BY e.start_at DESC
       LIMIT 30`,
    periodParams: "endOnly",
  },
};

export const NAMES = Object.keys(QUERIES);
