import { z } from "zod";
import { text, fail, namespaced } from "../../shared/mcp.js";
import { target, DATABASES, withConnection } from "./conn.js";
import { checkSql, checkPlan, MAX_ROWS } from "./guard.js";

export const NAMESPACE = "db";

// 한글 · 한자 · 전각 문자는 터미널에서 두 칸을 차지한다
const WIDE = /[\u1100-\u115f\u2e80-\ua4cf\uac00-\ud7a3\uf900-\ufaff\ufe30-\ufe4f\uff00-\uff60\uffe0-\uffe6]/;
const width = (s) => [...s].reduce((n, ch) => n + (WIDE.test(ch) ? 2 : 1), 0);
const pad = (s, w) => s + " ".repeat(Math.max(0, w - width(s)));

// 터미널에서 읽으므로 마크업 없이 표로 그린다. 긴 값(소개문 등)은 잘라 보여준다
function table(rows, cellMax = 60) {
  if (!rows.length) return "  (결과 없음)";
  const cols = Object.keys(rows[0]);
  const cell = (v) => {
    const s = v === null || v === undefined ? "" : typeof v === "object" ? JSON.stringify(v) : String(v);
    const one = s.replace(/\s+/g, " ");
    return one.length > cellMax ? one.slice(0, cellMax - 1) + "…" : one;
  };
  const body = rows.map((r) => cols.map((c) => cell(r[c])));
  const widths = cols.map((c, i) => Math.max(width(c), ...body.map((b) => width(b[i]))));
  const line = (cells) => "  " + cells.map((s, i) => pad(s, widths[i])).join("  ").trimEnd();
  return [line(cols), "  " + widths.map((w) => "─".repeat(w)).join("  "), ...body.map(line)].join("\n");
}

function explainError(e) {
  const m = String(e?.message || e);
  if (/Could not load credentials|CredentialsProviderError|Token is expired|SSO session/i.test(m))
    return "AWS 자격증명이 없습니다. aws configure (또는 aws sso login) 후 다시 부르세요. 접속 정보와 IAM 토큰을 각자의 자격증명으로 받습니다.";
  if (/Parameter Store 에 없는 값|AccessDenied.*ssm|ssm:GetParameters/i.test(m))
    return `DB 접속 정보를 Parameter Store 에서 읽지 못했습니다. DB 조회 정책이 붙은 IAM 사용자인지 확인하세요. (${m})`;
  if (/ECONNREFUSED/.test(m)) return "DB 터널이 닫혀 있습니다. storix-tunnel 로 운영 DB 터널을 여세요.";
  if (/Access denied/.test(m)) return `접속이 거부됐습니다. IAM 정책에 rds-db:connect 가 있는지, 토큰을 받은 AWS 프로필이 맞는지 확인하세요. (${m})`;
  if (/max_execution_time|maximum statement execution time/i.test(m)) return "실행 시간 제한(5초)을 넘어 중단했습니다. 범위를 좁혀 주세요.";
  if (/SELECT command denied/.test(m)) return `조회가 허용되지 않은 테이블입니다. (${m})`;
  return m;
}

export function register(server) {
  const tool = namespaced(server, NAMESPACE);
  const dbArg = z
    .enum(Object.keys(DATABASES))
    .default("prod")
    .describe(Object.entries(DATABASES).map(([k, v]) => `${k} = ${v}`).join(", "));

  tool(
    "tables",
    {
      title: "조회 가능한 테이블",
      description:
        "읽기 전용 계정으로 볼 수 있는 테이블 · 칼럼 · 인덱스 · 대략적인 행 수. db_query 를 쓰기 전에 어떤 칼럼에 인덱스가 있는지 먼저 본다.",
      inputSchema: { database: dbArg, table: z.string().optional().describe("이 테이블의 칼럼 · 인덱스만") },
    },
    async ({ database, table: only }) => {
      try {
        return await withConnection(database, async (conn, cfg) => {
          const schema = cfg[database];
          const [tables] = await conn.query(
            "SELECT TABLE_NAME AS `테이블`, TABLE_ROWS AS `대략 행 수` FROM information_schema.TABLES " +
              "WHERE TABLE_SCHEMA = ? AND (? IS NULL OR TABLE_NAME = ?) ORDER BY TABLE_NAME",
            [schema, only ?? null, only ?? null]
          );
          const out = [`${database} (${schema}) — ${target(cfg)}`, "", table(tables)];
          if (only) {
            const [cols] = await conn.query(
              "SELECT COLUMN_NAME AS `칼럼`, COLUMN_TYPE AS `타입`, IS_NULLABLE AS `NULL`, COLUMN_KEY AS `키` " +
                "FROM information_schema.COLUMNS WHERE TABLE_SCHEMA = ? AND TABLE_NAME = ? ORDER BY ORDINAL_POSITION",
              [schema, only]
            );
            const [idx] = await conn.query(
              "SELECT INDEX_NAME AS `인덱스`, GROUP_CONCAT(COLUMN_NAME ORDER BY SEQ_IN_INDEX) AS `칼럼`, " +
                "MIN(NON_UNIQUE) = 0 AS `유니크` FROM information_schema.STATISTICS " +
                "WHERE TABLE_SCHEMA = ? AND TABLE_NAME = ? GROUP BY INDEX_NAME",
              [schema, only]
            );
            out.push("", "칼럼", table(cols), "", "인덱스", table(idx));
          }
          return text(out.join("\n"));
        });
      } catch (e) {
        return fail(explainError(e));
      }
    }
  );

  tool(
    "query",
    {
      title: "운영 DB 읽기 전용 조회",
      description:
        `운영 DB 에 SELECT 한 문장을 보낸다. 결과는 최대 ${MAX_ROWS}행. ` +
        "락을 거는 조회(FOR UPDATE · FOR SHARE), 쓰기, SLEEP · GET_LOCK 같은 함수, 인덱스를 안 타는 큰 테이블 전체 스캔은 실행 전에 거부한다. " +
        "칼럼 · 인덱스는 db_tables 로 먼저 확인한다. 개인정보 테이블(user 등)은 권한이 없다.",
      inputSchema: {
        sql: z.string().describe("SELECT 한 문장"),
        database: dbArg,
      },
    },
    async ({ sql, database }) => {
      const checked = checkSql(sql);
      if (checked.error) return fail(checked.error);
      try {
        return await withConnection(database, async (conn) => {
          const [plan] = await conn.query(`EXPLAIN ${checked.sql}`);
          const reason = checkPlan(plan);
          if (reason) return fail(reason);
          const started = Date.now();
          const [rows] = await conn.query(checked.sql);
          return text(
            [`${database} — ${rows.length}행 · ${Date.now() - started}ms`, "", table(rows)].join("\n")
          );
        });
      } catch (e) {
        return fail(explainError(e));
      }
    }
  );
}
