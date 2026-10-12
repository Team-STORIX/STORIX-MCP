// db_query 로 들어온 SQL 을 운영 DB 에 보내도 되는지 판단한다. DB 계정은 SELECT 권한뿐이라
// 쓰기는 DB 가 막지만, 운영에 부담을 주는 조회(락 · 전체 스캔 · 오래 걸리는 함수)는 여기서 막는다.

export const MAX_ROWS = 500;
// 이 행 수가 넘는 테이블을 인덱스 없이 훑는 조회는 거부한다 (EXPLAIN 추정치 기준)
export const MAX_SCAN_ROWS = 1000;

// 문자열 · 식별자 안의 글자는 검사하지 않는다 ('for update' 가 들어간 작품명 등)
function stripLiterals(sql) {
  return sql
    .replace(/'(?:[^'\\]|\\.|'')*'/g, "''")
    .replace(/"(?:[^"\\]|\\.|"")*"/g, '""')
    .replace(/`[^`]*`/g, "``");
}

function stripComments(sql) {
  return sql.replace(/\/\*[\s\S]*?\*\//g, " ").replace(/(--\s|#)[^\n]*/g, " ");
}

const FORBIDDEN = [
  [/\bfor\s+update\b/i, "FOR UPDATE (행 잠금)"],
  [/\bfor\s+share\b/i, "FOR SHARE (공유 잠금)"],
  [/\block\s+in\s+share\s+mode\b/i, "LOCK IN SHARE MODE (공유 잠금)"],
  [/\binto\b/i, "INTO (파일 · 변수로 내보내기)"],
  [/\b(?:sleep|benchmark|get_lock|release_lock|release_all_locks|load_file)\s*\(/i, "운영에 영향을 주는 함수"],
  [/\b(?:insert|update|delete|replace|create|alter|drop|truncate|rename|grant|revoke|lock|unlock|handler|load|call|set|do)\b/i, "SELECT 가 아닌 문장"],
  [/\b(?:mysql|performance_schema|sys)\s*\./i, "시스템 스키마"],
];

/**
 * SQL 검사. 통과하면 { sql } (LIMIT 이 없으면 붙인다), 아니면 { error }.
 */
export function checkSql(raw) {
  const sql = stripComments(String(raw ?? "")).trim().replace(/;\s*$/, "");
  if (!sql) return { error: "SQL 이 비어 있습니다." };
  const bare = stripLiterals(sql);
  if (bare.includes(";")) return { error: "한 번에 한 문장만 보낼 수 있습니다." };
  if (!/^(select|with)\b/i.test(bare)) return { error: "SELECT (또는 WITH … SELECT) 만 보낼 수 있습니다." };
  for (const [re, label] of FORBIDDEN) {
    if (re.test(bare)) return { error: `허용하지 않는 구문입니다: ${label}` };
  }
  const limit = bare.match(/\blimit\s+(\d+)(?:\s*,\s*(\d+))?\s*(?:offset\s+\d+\s*)?$/i);
  if (limit) {
    const n = Number(limit[2] ?? limit[1]);
    if (n > MAX_ROWS) return { error: `LIMIT 은 ${MAX_ROWS} 이하로 주세요 (${n}).` };
    return { sql };
  }
  return { sql: `${sql}\nLIMIT ${MAX_ROWS}` };
}

/**
 * EXPLAIN 결과 행들 → 거부 사유 (없으면 null).
 * type ALL(전체 스캔) · index(인덱스 전체 스캔) 이면서 추정 행이 MAX_SCAN_ROWS 를 넘으면 인덱스를 안 타는 조회로 본다.
 */
export function checkPlan(rows) {
  const heavy = (rows || []).filter(
    (r) => ["ALL", "index"].includes(r.type) && Number(r.rows || 0) > MAX_SCAN_ROWS
  );
  if (!heavy.length) return null;
  const what = heavy
    .map((r) => `${r.table} (${r.type === "ALL" ? "전체 스캔" : "인덱스 전체 스캔"}, 약 ${r.rows}행)`)
    .join(", ");
  return `인덱스를 타지 않는 조회라 보내지 않았습니다: ${what}. WHERE 에 인덱스가 걸린 칼럼(작품 ID · 플랫폼 · 링크 등)을 넣어 범위를 좁혀 주세요.`;
}
