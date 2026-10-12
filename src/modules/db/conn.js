import mysql from "mysql2/promise";

// 운영 DB 읽기 전용 접속. 비밀번호 대신 RDS IAM 인증 토큰을 각자의 AWS 자격증명으로 받는다.
// rds-db:connect 권한이 있는 사람만 접속되고, 누가 붙었는지 CloudTrail 에 남는다.
// RDS 는 사설망이라 SSM 터널(storix-tunnel, 127.0.0.1:13306)로 붙는다. 토큰은 실제 RDS 주소로 서명해야 한다.
const REGION = process.env.AWS_REGION || process.env.AWS_DEFAULT_REGION || "ap-northeast-2";
const RDS_HOST = process.env.STORIX_READER_RDS_HOST || ""; // 토큰 서명용 RDS 엔드포인트
const HOST = process.env.STORIX_READER_HOST || "127.0.0.1";
const PORT = Number(process.env.STORIX_READER_PORT || 13306);
const USER = process.env.STORIX_READER_USER || "DB_USER";
const TIMEOUT_MS = Number(process.env.STORIX_READER_TIMEOUT_MS || 5000);

// 조회할 수 있는 DB. 키는 툴 인자, 값은 스키마 이름
export const DATABASES = {
  prod: process.env.STORIX_READER_PROD_DB || "PROD_DB",
  staging: process.env.STORIX_READER_STAGING_DB || "STAGING_DB",
};

export const configured = Boolean(RDS_HOST);
export const target = `${USER}@${HOST}:${PORT} (IAM, ${RDS_HOST || "STORIX_READER_RDS_HOST 없음"})`;

let signerPromise = null;

async function token() {
  if (!signerPromise) {
    signerPromise = (async () => {
      let mod;
      try {
        mod = await import("@aws-sdk/rds-signer");
      } catch {
        throw new Error("@aws-sdk/rds-signer 를 불러오지 못했습니다. npm install 을 다시 해보세요.");
      }
      return new mod.Signer({ region: REGION, hostname: RDS_HOST, port: 3306, username: USER });
    })();
  }
  return (await signerPromise).getAuthToken(); // 15분짜리. 연결할 때마다 새로 받는다
}

/**
 * 한 번 쓰고 닫는 연결. 운영 DB 에 연결을 붙잡아 두지 않는다.
 * 세션은 읽기 전용 · READ COMMITTED(갭 락 없음) · 실행 시간 · 락 대기 제한을 건다.
 */
export async function withConnection(database, fn) {
  if (!configured) throw new Error("STORIX_READER_RDS_HOST 가 없어 DB 조회를 할 수 없습니다.");
  const authToken = await token();
  const conn = await mysql.createConnection({
    host: HOST,
    port: PORT,
    user: USER,
    database,
    connectTimeout: TIMEOUT_MS,
    timezone: "+09:00",
    dateStrings: true,
    multipleStatements: false,
    charset: "utf8mb4_general_ci",
    // IAM 인증은 TLS 가 필수다. 터널(127.0.0.1)로 붙어 인증서 호스트 이름이 RDS 와 달라 이름 검증만 끈다
    ssl: { rejectUnauthorized: false },
    authPlugins: { mysql_clear_password: () => () => Buffer.from(authToken + "\0") },
  });
  try {
    await conn.query("SET SESSION TRANSACTION READ ONLY");
    await conn.query("SET SESSION TRANSACTION ISOLATION LEVEL READ COMMITTED");
    await conn.query(`SET SESSION max_execution_time = ${TIMEOUT_MS}`);
    await conn.query("SET SESSION innodb_lock_wait_timeout = 2");
    return await fn(conn);
  } finally {
    await conn.end().catch(() => {});
  }
}
