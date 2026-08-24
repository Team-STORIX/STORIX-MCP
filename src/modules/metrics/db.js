import mysql from "mysql2/promise";

const HOST = process.env.STORIX_DB_HOST || "";
const PORT = Number(process.env.STORIX_DB_PORT || 3306);
const USER = process.env.STORIX_DB_USER || "";
const PASSWORD = process.env.STORIX_DB_PASSWORD || "";
const DATABASE = process.env.STORIX_DB_NAME || "";
const TIMEOUT_MS = Number(process.env.STORIX_DB_TIMEOUT_MS || 5000);

export const configured = Boolean(HOST && USER && DATABASE);
export const target = `${USER}@${HOST}:${PORT}/${DATABASE}`;

let pool = null;

// dev 와 prod 가 같은 인스턴스를 스키마로만 나눠 쓴다. 조회 하나가 운영 자원을 먹으므로
// 읽기 전용 · 짧은 타임아웃 · 락 대기 없음을 연결 단계에서 못박는다.
function getPool() {
  if (pool) return pool;
  pool = mysql.createPool({
    host: HOST,
    port: PORT,
    user: USER,
    password: PASSWORD,
    database: DATABASE,
    connectionLimit: 2,
    connectTimeout: TIMEOUT_MS,
    timezone: "+09:00",
    dateStrings: true,
    multipleStatements: false,
    charset: "utf8mb4_general_ci",
  });

  pool.on("connection", (conn) => {
    conn.query("SET SESSION TRANSACTION READ ONLY");
    conn.query(`SET SESSION max_execution_time = ${TIMEOUT_MS}`);
    conn.query("SET SESSION innodb_lock_wait_timeout = 2");
  });
  return pool;
}

export async function query(sql, params = []) {
  const [rows] = await getPool().execute(sql, params);
  return rows;
}

export async function close() {
  if (pool) {
    await pool.end();
    pool = null;
  }
}
