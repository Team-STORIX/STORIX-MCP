// 슬랙에 올릴 스펙 변경 알림. BE 의 SlackNotificationService 와 같은 결로 맞춘다.
// 제목은 *[이모지 제목]*, 부연은 "- " 줄, 필드는 :이모지: *라벨:* 값.

// 섹션 블록 하나는 3000자까지다. 한 블록에 우겨넣다 자르지 말고 여러 블록으로 나눈다.
const MAX_SECTION = 2800;
const MAX_SECTIONS = 8;

// 태그 묶음 사이(빈 줄)에서 끊는다. 문장 중간에서 끊기면 읽을 수 없다.
function sections(body) {
  const out = [];
  let cur = "";
  for (const part of body.split("\n\n")) {
    if (cur && cur.length + part.length + 2 > MAX_SECTION) {
      out.push(cur);
      cur = part;
    } else {
      cur = cur ? `${cur}\n\n${part}` : part;
    }
  }
  if (cur) out.push(cur);
  return out;
}

export function buildChangelogPayload({ env, sha, pr, from, to, breaks, added, actionable, body }) {
  const head = [`*[📋 API 스펙 변경]*`];
  if (env) head.push(`- 환경: \`${env}\``);
  if (sha) head.push(`- 배포: \`${sha}\``);
  if (pr) head.push(`- PR: #${pr}`);
  if (from && to) head.push(`- 비교: \`${from}\` → \`${to}\``);

  const quiet = !breaks && !added && !actionable;

  // 라벨만 던지면 무슨 뜻인지 매번 묻게 된다. 한 줄로 같이 적는다.
  const fields = quiet
    ? [":white_check_mark: *스펙 변경 없음*"]
    : [
        `:rotating_light: *기존 동작 깨짐:* ${breaks}`,
        `:sparkles: *신규:* ${added}`,
        `:pencil2: *반영 필요:* ${actionable}`,
        "",
        "_깨짐 = 지금 앱이 오작동할 수 있음 · 반영 필요 = 앱은 멀쩡하지만 새로 붙여야 함_",
      ];

  const blocks = [
    { type: "section", text: { type: "mrkdwn", text: [...head, "", ...fields].join("\n") } },
  ];

  if (!quiet && body) {
    const parts = sections(body);
    blocks.push({ type: "divider" });
    for (const part of parts.slice(0, MAX_SECTIONS)) {
      blocks.push({ type: "section", text: { type: "mrkdwn", text: part } });
    }
    if (parts.length > MAX_SECTIONS) {
      blocks.push({
        type: "context",
        elements: [{ type: "mrkdwn", text: "변경이 많아 뒷부분은 생략했습니다. 자세한 건 CloudWatch 로그." }],
      });
    }
  }

  const summary = quiet
    ? "API 스펙 변경 없음"
    : `API 스펙 변경 · 깨짐 ${breaks} · 신규 ${added} · 반영 필요 ${actionable}`;

  return { text: summary, blocks };
}
