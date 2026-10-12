import mysql from "mysql2/promise";

// 운영 DB 읽기 전용 접속. 비밀번호 대신 RDS IAM 인증 토큰을 각자의 AWS 자격증명으로 받는다.
// rds-db:connect 권한이 있는 사람만 접속되고, 누가 붙었는지 CloudTrail 에 남는다.
// RDS 는 사설망이라 SSM 터널(storix-tunnel)로 붙는다. 토큰은 실제 RDS 주소로 서명해야 한다.
// 공개 패키지라 RDS 주소 · 계정 · 스키마 이름은 코드에 두지 않고 Parameter Store(<prefix>/db/*)에서 읽는다.
// 같은 정책이 읽기 권한과 접속 권한을 함께 주므로, 값을 읽을 수 있는 사람만 붙을 수 있다.
const REGION = process.env.AWS_REGION || process.env.AWS_DEFAULT_REGION || "ap-northeast-2";
const HOST = process.env.STORIX_READER_HOST || "127.0.0.1"; // 터널 로컬 주소
const PORT = Number(process.env.STORIX_READER_PORT || 13306);
const TIMEOUT_MS = Number(process.env.STORIX_READER_TIMEOUT_MS || 5000);

const PARAMS = { rdsHost: "db/rds-host", user: "db/user", prod: "db/prod-db", staging: "db/staging-db" };

// 툴 인자로 고르는 DB. 실제 스키마 이름은 설정에서 찾는다
export const DATABASES = { prod: "서비스 DB", staging: "크롤러 검수 DB" };

let configPromise = null;

/** 접속 설정. 환경변수(STORIX_READER_RDS_HOST 등)가 다 있으면 그걸, 아니면 Parameter Store 에서 한 번 읽는다 */
export function config() {
  if (configPromise) return configPromise;
  configPromise = (async () => {
    const env = {
      rdsHost: process.env.STORIX_READER_RDS_HOST,
      user: process.env.STORIX_READER_USER,
      prod: process.env.STORIX_READER_PROD_DB,
      staging: process.env.STORIX_READER_STAGING_DB,
    };
    if (Object.values(env).every(Boolean)) return env;
    const { readParams } = await import("../../shared/params.js");
    const got = await readParams(Object.values(PARAMS));
    return Object.fromEntries(Object.entries(PARAMS).map(([k, name]) => [k, env[k] || got[name]]));
  })();
  configPromise.catch(() => (configPromise = null)); // 권한을 고친 뒤 다시 부를 수 있게
  return configPromise;
}

export const target = (cfg) => `${cfg.user}@${HOST}:${PORT} (IAM)`;

let signerPromise = null;

async function token(cfg) {
  if (!signerPromise) {
    signerPromise = (async () => {
      let mod;
      try {
        mod = await import("@aws-sdk/rds-signer");
      } catch {
        throw new Error("@aws-sdk/rds-signer 를 불러오지 못했습니다. npm install 을 다시 해보세요.");
      }
      return new mod.Signer({ region: REGION, hostname: cfg.rdsHost, port: 3306, username: cfg.user });
    })();
  }
  return (await signerPromise).getAuthToken(); // 15분짜리. 연결할 때마다 새로 받는다
}

/**
 * 한 번 쓰고 닫는 연결. database 는 DATABASES 의 키(prod · staging). 운영 DB 에 연결을 붙잡아 두지 않는다.
 * 세션은 읽기 전용 · READ COMMITTED(갭 락 없음) · 실행 시간 · 락 대기 제한을 건다.
 */
export async function withConnection(database, fn) {
  const cfg = await config();
  const authToken = await token(cfg);
  const conn = await mysql.createConnection({
    host: HOST,
    port: PORT,
    user: cfg.user,
    database: cfg[database],
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
    return await fn(conn, cfg);
  } finally {
    await conn.end().catch(() => {});
  }
}
