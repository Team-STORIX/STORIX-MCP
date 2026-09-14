import { FRONTEND, BACKEND, UNCLEAR } from "./verdict.js";

const WEBHOOK = process.env.STORIX_SLACK_WEBHOOK_URL || "";
const CHANNEL = process.env.STORIX_SLACK_CHANNEL || "#오류-제보";

export const configured = Boolean(WEBHOOK);
export const channelName = CHANNEL;

const MARK = {
  [FRONTEND]: ["🔵", "프론트"],
  [BACKEND]: ["🔴", "백엔드"],
  both: ["🟠", "양쪽"],
  [UNCLEAR]: ["⚪", "확인필요"],
};

const short = (value, max = 400) => {
  if (value === undefined) return null;
  const s = typeof value === "string" ? value : JSON.stringify(value);
  return s.length > max ? `${s.slice(0, max)} …(생략)` : s;
};

// 제보 형식을 하나로 고정한다. 채널에 같은 모양으로 쌓여야 나중에 훑어볼 수 있다.
// 같은 내용을 두 가지로 그린다. 슬랙 마크업은 터미널에서 그대로 노출돼 읽기 나쁘고,
// 사용자는 터미널에서 확인한 뒤 슬랙으로 보내기 때문이다.
const RULE = "─".repeat(30);

function sections({ input, result, symptom, expected, reporter, specVersion }) {
  const [icon, who] = MARK[result.verdict] || MARK[UNCLEAR];

  const findings = result.findings.length
    ? result.findings.map((f) => {
        const side = f.side === FRONTEND ? "프론트" : f.side === BACKEND ? "백엔드" : "확인필요";
        return `  • [${side}]${f.soft ? " (참고)" : ""} ${f.text}`;
      })
    : ["  • 스펙과 어긋나는 점은 없습니다."];

  const repro = [
    input.query !== undefined && `쿼리  ${short(input.query)}`,
    input.request !== undefined && `요청  ${short(input.request)}`,
    input.status !== undefined && `응답  ${input.status} ${short(input.response) ?? ""}`.trim(),
  ].filter(Boolean);

  return {
    icon,
    who,
    operation: `${input.method.toUpperCase()} ${input.path}`,
    summary: result.summary,
    symptom,
    expected,
    findings: [...findings, ...result.notes.map((n) => `  · ${n}`)],
    repro,
    meta: [reporter && `제보 ${reporter}`, "dev", specVersion && `스펙 v${specVersion}`].filter(Boolean),
  };
}

function render(s, { bold, fence }) {
  const label = (t) => bold(`[${t}]`);
  const lines = [`${s.icon}  ${bold(`[${s.who}]`)}  ${s.operation}`];
  if (s.summary) lines.push(`    ${s.summary}`);

  lines.push(RULE, `${label("증상")}  ${s.symptom}`);
  if (s.expected) lines.push(`${label("기대")}  ${s.expected}`);

  lines.push(RULE, label("판정 근거"), ...s.findings);

  if (s.repro.length) {
    lines.push(RULE, label("재현"), ...fence(s.repro));
  }

  lines.push(RULE, s.meta.join("  ·  "));
  return lines.join("\n");
}

// 터미널에서 읽을 것. 마크업 없이 들여쓰기로만 구분한다.
export function buildMessage(data) {
  return render(sections(data), {
    bold: (t) => t,
    fence: (rows) => rows.map((r) => `  ${r}`),
  });
}

// 슬랙에 올라갈 것.
export function buildSlackMessage(data) {
  return render(sections(data), {
    bold: (t) => `*${t}*`,
    fence: (rows) => ["```", ...rows, "```"],
  });
}

// 문자열이면 그대로 text 로, 객체면 payload 로 본다.
export async function send(message) {
  if (!WEBHOOK) return { sent: false, reason: "webhook 미설정" };

  const payload = typeof message === "string" ? { text: message } : message;

  let res;
  try {
    res = await fetch(WEBHOOK, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(payload),
    });
  } catch (e) {
    return { sent: false, reason: `전송 실패: ${e.message}` };
  }

  if (!res.ok) return { sent: false, reason: `전송 실패: HTTP ${res.status} ${await res.text()}` };
  return { sent: true };
}
