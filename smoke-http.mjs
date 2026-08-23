// HTTP 모드 스모크 테스트. 서버를 먼저 띄운 뒤 실행한다.
//
//   SWAGGER_USER=... SWAGGER_PASSWORD=... MCP_PORT=3400 node src/http.js &
//   SWAGGER_USER=... SWAGGER_PASSWORD=... MCP_URL=http://127.0.0.1:3400/mcp node smoke-http.mjs
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StreamableHTTPClientTransport } from "@modelcontextprotocol/sdk/client/streamableHttp.js";

const MCP_URL = process.env.MCP_URL || "http://127.0.0.1:8090/mcp";
const USER = process.env.MCP_BASIC_USER || process.env.SWAGGER_USER;
const PASSWORD = process.env.MCP_BASIC_PASSWORD || process.env.SWAGGER_PASSWORD;

if (!USER || !PASSWORD) {
  console.error("SWAGGER_USER / SWAGGER_PASSWORD 를 환경변수로 넘기세요.");
  process.exit(1);
}

const auth = "Basic " + Buffer.from(`${USER}:${PASSWORD}`).toString("base64");
const JSON_HEADERS = { "Content-Type": "application/json", Accept: "application/json, text/event-stream" };
const PING = JSON.stringify({ jsonrpc: "2.0", method: "ping", id: 1 });

let failed = 0;
const check = (label, actual, expected) => {
  const ok = actual === expected;
  if (!ok) failed++;
  console.log(`${ok ? "OK  " : "FAIL"} ${label}: ${actual} (기대 ${expected})`);
};

const status = async (headers) =>
  (await fetch(MCP_URL, { method: "POST", headers: { ...JSON_HEADERS, ...headers }, body: PING })).status;

check("인증 없음", await status({}), 401);
check("틀린 비밀번호", await status({ Authorization: "Basic " + Buffer.from(`${USER}:wrong`).toString("base64") }), 401);
check("허용되지 않은 Origin", await status({ Authorization: auth, Origin: "https://evil.example" }), 403);
check("healthz", (await fetch(new URL("/mcp/healthz", MCP_URL))).status, 200);

const client = new Client({ name: "smoke-http", version: "1.0.0" });
await client.connect(
  new StreamableHTTPClientTransport(new URL(MCP_URL), { requestInit: { headers: { Authorization: auth } } })
);

const tools = await client.listTools();
check("툴 개수", tools.tools.length, 7);

const spec = await client.callTool({ name: "swagger_refresh_spec", arguments: {} });
console.log(`     ${spec.content[0].text}`);

const write = await client.callTool({ name: "swagger_call_api", arguments: { method: "DELETE", path: "/x" } });
check("쓰기 차단", write.isError === true, process.env.SWAGGER_MCP_ALLOW_WRITE !== "true");

await client.close();
console.log(failed ? `\n실패 ${failed}건` : "\n전부 통과");
process.exit(failed ? 1 : 0);
