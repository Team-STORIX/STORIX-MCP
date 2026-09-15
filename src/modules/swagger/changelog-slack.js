// 슬랙에 올릴 스펙 변경 알림. BE 의 SlackNotificationService 와 같은 결로 맞춘다.
// 제목은 *[이모지 제목]*, 부연은 "- " 줄, 필드는 :이모지: *라벨:* 값.

// 슬랙 text 블록은 3000자까지다. 길면 잘라서 담는다.
const MAX_BODY = 2600;

function trim(text) {
  if (text.length <= MAX_BODY) return text;
  return text.slice(0, MAX_BODY) + "\n…(생략, 자세한 건 CloudWatch 로그)";
}

export function buildChangelogPayload({ env, sha, pr, from, to, breaks, added, actionable, body }) {
  const head = [`*[📋 API 스펙 변경]*`];
  if (env) head.push(`- 환경: \`${env}\``);
  if (sha) head.push(`- 배포: \`${sha}\``);
  if (pr) head.push(`- PR: #${pr}`);
  if (from && to) head.push(`- 비교: \`${from}\` → \`${to}\``);

  const quiet = !breaks && !added && !actionable;

  // 깨짐은 "지금 앱이 오작동하나", 반영 필요는 "안 깨지지만 붙여야 하나" 다.
  const fields = quiet
    ? [":white_check_mark: *스펙 변경 없음*"]
    : [
        `:rotating_light: *깨짐:* ${breaks}`,
        `:sparkles: *신규:* ${added}`,
        `:pencil2: *반영 필요:* ${actionable}`,
      ];

  const blocks = [
    { type: "section", text: { type: "mrkdwn", text: [...head, "", ...fields].join("\n") } },
  ];

  if (!quiet && body) {
    blocks.push({ type: "divider" });
    blocks.push({ type: "section", text: { type: "mrkdwn", text: trim(body) } });
  }

  const summary = quiet
    ? "API 스펙 변경 없음"
    : `API 스펙 변경 · 깨짐 ${breaks} · 신규 ${added} · 반영 필요 ${actionable}`;

  return { text: summary, blocks };
}
