#!/usr/bin/env node
import { createServer } from "node:http";
import { timingSafeEqual } from "node:crypto";
import { StreamableHTTPServerTransport } from "@modelcontextprotocol/sdk/server/streamableHttp.js";
import { buildServer } from "./server.js";

// 3000은 프론트 dev 서버가 쓰므로 피한다
const PORT = Number(process.env.MCP_PORT || 8090);
const USER = process.env.MCP_BASIC_USER || process.env.SWAGGER_USER || "";
const PASSWORD = process.env.MCP_BASIC_PASSWORD || process.env.SWAGGER_PASSWORD || "";

if (!USER || !PASSWORD) {
  console.error("MCP_BASIC_USER/PASSWORD (또는 SWAGGER_USER/PASSWORD) 없이는 띄울 수 없습니다.");
  process.exit(1);
}

// 브라우저는 교차 출처 요청에 Origin을 반드시 붙인다. 그래서 Origin이 있는데 허용 목록에
// 없으면 DNS 리바인딩 시도로 보고 거절한다. CLI 클라이언트(Claude Code)는 Origin을 안 보내므로
// 헤더가 없는 경우는 통과시킨다.
const ALLOWED_ORIGINS = new Set(
  (process.env.MCP_ALLOWED_ORIGINS || "")
    .split(",")
    .map((s) => s.trim())
    .filter(Boolean)
);

function originAllowed(req) {
  const origin = req.headers.origin;
  if (!origin) return true;
  return ALLOWED_ORIGINS.has(origin);
}

function authorized(req) {
  const header = req.headers.authorization || "";
  if (!header.startsWith("Basic ")) return false;
  const got = Buffer.from(header.slice(6), "base64");
  const expected = Buffer.from(`${USER}:${PASSWORD}`, "utf8");
  return got.length === expected.length && timingSafeEqual(got, expected);
}

function deny(res, status, message) {
  const headers = { "Content-Type": "application/json" };
  if (status === 401) headers["WWW-Authenticate"] = 'Basic realm="storix-mcp"';
  res.writeHead(status, headers);
  res.end(JSON.stringify({ jsonrpc: "2.0", error: { code: -32000, message }, id: null }));
}

const httpServer = createServer(async (req, res) => {
  const url = new URL(req.url, "http://localhost");

  if (url.pathname === "/mcp/healthz") {
    res.writeHead(200, { "Content-Type": "text/plain" }).end("ok");
    return;
  }
  if (url.pathname !== "/mcp") {
    deny(res, 404, "Not found");
    return;
  }
  // 인증보다 먼저 본다. 거절할 요청에 자격증명 검사를 태울 이유가 없다.
  if (!originAllowed(req)) {
    deny(res, 403, `Origin not allowed: ${req.headers.origin}`);
    return;
  }
  if (!authorized(req)) {
    deny(res, 401, "Unauthorized");
    return;
  }
  // 세션 없는 stateless 모드라 POST만 받는다. GET(SSE 스트림)/DELETE(세션 종료)는 해당 없음.
  if (req.method !== "POST") {
    deny(res, 405, "Method not allowed");
    return;
  }

  // 요청마다 독립 인스턴스: 동시 사용자끼리 상태가 섞이지 않는다.
  const server = await buildServer({ local: false });
  const transport = new StreamableHTTPServerTransport({ sessionIdGenerator: undefined });
  res.on("close", () => {
    transport.close();
    server.close();
  });

  try {
    await server.connect(transport);
    await transport.handleRequest(req, res);
  } catch (e) {
    console.error("요청 처리 실패", e);
    if (!res.headersSent) deny(res, 500, "Internal error");
  }
});

httpServer.listen(PORT, () => {
  console.log(`storix MCP http://0.0.0.0:${PORT}/mcp (basic auth: ${USER})`);
});
