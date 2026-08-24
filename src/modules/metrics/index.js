import { z } from "zod";
import { text, fail, namespaced } from "../../shared/mcp.js";
import { configured, target, query } from "./db.js";
import { QUERIES, NAMES, MAX_DAYS } from "./queries.js";

export const NAMESPACE = "metrics";

const DAY_MS = 86400_000;

function parseDate(value, fallback) {
  if (!value) return fallback;
  const t = Date.parse(value.length <= 10 ? `${value}T00:00:00+09:00` : value);
  return Number.isNaN(t) ? null : new Date(t);
}

const iso = (d) => new Date(d.getTime() + 9 * 3600_000).toISOString().slice(0, 19).replace("T", " ");

// 결과를 표로 그린다. 프론트도 기획도 터미널에서 읽으므로 마크업을 쓰지 않는다
function table(rows) {
  if (!rows.length) return "  (해당 기간에 데이터가 없습니다)";
  const cols = Object.keys(rows[0]);
  const width = Object.fromEntries(
    cols.map((c) => [c, Math.max(String(c).length, ...rows.map((r) => String(r[c] ?? "").length))])
  );
  const line = (cells) => "  " + cols.map((c, i) => String(cells[i] ?? "").padEnd(width[c])).join("  ");
  return [line(cols), "  " + cols.map((c) => "─".repeat(width[c])).join("  "), ...rows.map((r) => line(cols.map((c) => r[c])))].join("\n");
}

export function register(server) {
  const tool = namespaced(server, NAMESPACE);

  tool(
    "list",
    {
      title: "지표 목록",
      description: "물어볼 수 있는 지표와 각 지표가 무엇을 세는지, 해석할 때 주의할 점을 보여준다.",
      inputSchema: {},
    },
    async () => {
      const lines = [`지표 ${NAMES.length}개`, ""];
      for (const name of NAMES) {
        const q = QUERIES[name];
        lines.push(`${name}  ${q.title}`);
        lines.push(`  ${q.description}`);
        lines.push("");
      }
      lines.push(configured ? `연결 대상 ${target}` : "DB 설정이 없어 조회는 되지 않습니다.");
      return text(lines.join("\n"));
    }
  );

  tool(
    "query",
    {
      title: "지표 조회",
      description:
        "미리 정의된 집계 질의를 돌린다. 자유 SQL 은 받지 않는다 - 집계만 나가므로 개인을 특정하는 값이 응답에 담기지 않는다. " +
        "각 지표가 무엇을 세는지와 해석 주의점은 metrics_list 로 먼저 확인한다.",
      inputSchema: {
        name: z.enum(NAMES).describe("지표 이름"),
        since: z.string().optional().describe("시작일 YYYY-MM-DD. 생략하면 7일 전"),
        until: z.string().optional().describe("종료일 YYYY-MM-DD (제외). 생략하면 내일"),
      },
    },
    async ({ name, since, until }) => {
      if (!configured) {
        return fail(
          "DB 설정이 없습니다. STORIX_DB_HOST / STORIX_DB_USER / STORIX_DB_PASSWORD / STORIX_DB_NAME 을 넣어야 합니다.\n" +
            "읽기 전용 계정으로만 붙이세요. 같은 인스턴스를 운영과 공유하므로 쓰기 권한이 있으면 안 됩니다."
        );
      }

      const q = QUERIES[name];
      const now = Date.now();
      const from = parseDate(since, new Date(now - 7 * DAY_MS));
      const to = parseDate(until, new Date(now + DAY_MS));
      if (!from || !to) return fail("날짜는 YYYY-MM-DD 형식으로 넣으세요.");
      if (from >= to) return fail("시작일이 종료일보다 뒤입니다.");

      const days = Math.ceil((to - from) / DAY_MS);
      if (days > MAX_DAYS) {
        return fail(`한 번에 볼 수 있는 기간은 ${MAX_DAYS}일까지입니다 (요청 ${days}일). 운영과 같은 인스턴스라 긴 스캔을 막아뒀습니다.`);
      }

      const params = q.ignoresPeriod ? [] : q.periodParams === "endOnly" ? [iso(to)] : [iso(from), iso(to)];

      let rows;
      const started = Date.now();
      try {
        rows = await query(q.sql, params);
      } catch (e) {
        return fail(`조회 실패: ${e.message}`);
      }
      const elapsed = Date.now() - started;

      const scope = q.ignoresPeriod ? "현재 시점" : `${iso(from).slice(0, 10)} ~ ${iso(to).slice(0, 10)}`;
      return text(
        `${q.title}  ${scope}  ${rows.length}행 · ${elapsed}ms\n\n${table(rows)}\n\n  ${q.description}`
      );
    }
  );
}
