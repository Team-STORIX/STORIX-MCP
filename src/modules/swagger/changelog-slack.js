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

// 작업자 표시는 부르는 쪽이 정해서 넘긴다. 이 패키지는 공개라 사람 이름표를 두지 않는다.
export function buildChangelogPayload({ env, sha, pr, title, author, from, to, breaks, added, actionable, body }) {
  const head = [`*[📋 API 스펙 변경]*`];
  if (title) head.push(`- 작업: ${title}`);
  if (author) head.push(`- 작업자: ${author}`);
  if (env) head.push(`- 환경: \`${env}\``);
  if (sha) head.push(`- 배포: \`${sha}\``);
  if (pr) head.push(`- PR: #${pr}`);
  if (from && to) head.push(`- 비교: \`${from}\` → \`${to}\``);

  const quiet = !breaks && !added && !actionable;

  // 자세한 비교는 MCP 로 본다. 여기서는 변경이 있다는 것과 어디가 바뀌었는지만 알린다.
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
    const parts = sections(body);
    blocks.push({ type: "divider" });
    for (const part of parts.slice(0, MAX_SECTIONS)) {
      blocks.push({ type: "section", text: { type: "mrkdwn", text: part } });
    }
    if (parts.length > MAX_SECTIONS) {
      blocks.push({
        type: "context",
        elements: [{ type: "mrkdwn", text: "변경이 많아 뒷부분은 생략했습니다. 전체는 `swagger_diff_spec` 으로 보세요." }],
      });
    }
  }

  const summary = quiet
    ? "API 스펙 변경 없음"
    : `API 스펙 변경 · 깨짐 ${breaks} · 신규 ${added} · 반영 필요 ${actionable}`;

  return { text: summary, blocks };
}
