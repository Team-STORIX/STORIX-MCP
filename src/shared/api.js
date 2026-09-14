import { BASE_URL } from "./config.js";
import { getSession, refreshSession, isExpired } from "./session.js";
import { redact } from "./redact.js";

const DEV_TOKEN = process.env.STORIX_DEV_TOKEN || "";
const WRITE_METHODS = new Set(["POST", "PUT", "PATCH", "DELETE"]);

// 쓰기 허용은 사람이 MCP 설정에서 켜야 한다. AI가 인자로 열 수 있으면 관문이 아니다.
export const WRITE_ENABLED = process.env.SWAGGER_MCP_ALLOW_WRITE === "true";

export const isWrite = (method) => WRITE_METHODS.has(method.toUpperCase());

// dev 서버로 요청 하나를 보낸다. 실패하면 { error } 를, 응답을 받으면 상태와 본문을 돌려준다.
// 토큰은 인자 → auth_login 세션 → STORIX_DEV_TOKEN 순으로 쓴다.
export async function callApi({ method, path, pathParams, query, body, headers, token }) {
  const m = method.toUpperCase();
  if (isWrite(m) && !WRITE_ENABLED) {
    return {
      error:
        `${m}은 dev 데이터를 변경하므로 이 서버에서 막혀 있습니다.\n\n` +
        `허용하려면 사용자가 MCP 설정에 SWAGGER_MCP_ALLOW_WRITE=true 를 넣고 재시작해야 합니다. ` +
        `이 도구의 인자로는 켤 수 없습니다.`,
    };
  }

  let filled = path;
  for (const [k, v] of Object.entries(pathParams || {})) {
    filled = filled.replaceAll(`{${k}}`, encodeURIComponent(String(v)));
  }
  const missing = filled.match(/\{[^}]+\}/g);
  if (missing) return { error: `경로 변수 ${missing.join(", ")} 가 안 채워졌습니다. pathParams로 넘기세요.` };

  // 절대 URL 도 받지만 설정된 호스트로만 나간다. 아니면 토큰이 딸려서 아무 데나 갈 수 있다
  let url;
  try {
    url = new URL(filled.startsWith("http") ? filled : `${BASE_URL}${filled}`);
  } catch {
    return { error: `경로를 URL 로 만들 수 없습니다: ${filled}` };
  }
  const origin = new URL(BASE_URL).origin;
  if (url.origin !== origin) {
    return {
      error:
        `${url.origin} 으로는 보낼 수 없습니다. 이 도구는 ${origin} 로만 요청합니다.\n` +
        `요청에 인증 토큰이 함께 나가므로 대상 호스트를 고정해 뒀습니다.`,
    };
  }
  for (const [k, v] of Object.entries(query || {})) url.searchParams.set(k, String(v));

  const usedSession = !token && Boolean(getSession());
  if (usedSession && isExpired()) await refreshSession(BASE_URL);

  const bearerOf = () => token || getSession()?.accessToken || DEV_TOKEN;
  const reqHeaders = { Accept: "application/json", ...(headers || {}) };
  if (body !== undefined) reqHeaders["Content-Type"] = "application/json";

  const send = () => {
    const bearer = bearerOf();
    const h = { ...reqHeaders };
    if (bearer) h.Authorization = `Bearer ${bearer}`;
    return fetch(url, { method: m, headers: h, body: body === undefined ? undefined : JSON.stringify(body) });
  };

  const started = Date.now();
  let res;
  let refreshed = false;
  try {
    res = await send();
    // 만료를 미리 못 잡는 경우가 있다. 401이면 한 번만 다시 받아서 재시도한다.
    if (res.status === 401 && usedSession && (await refreshSession(BASE_URL))) {
      refreshed = true;
      res = await send();
    }
  } catch (e) {
    return { error: `요청 실패: ${e.message}` };
  }
  const elapsed = Date.now() - started;

  const raw = await res.text();
  let json = null;
  try {
    json = JSON.parse(raw);
  } catch {
    // JSON이 아니면 원문 그대로
  }

  return {
    method: m,
    url,
    status: res.status,
    statusText: res.statusText,
    ok: res.ok,
    elapsed,
    json,
    pretty: redact(json === null ? raw : JSON.stringify(json, null, 2)),
    refreshed,
    usedSession,
    hadToken: Boolean(bearerOf()),
  };
}
