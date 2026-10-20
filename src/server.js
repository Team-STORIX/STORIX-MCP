import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { modules } from "./modules/index.js";

export const NAME = "storix";
export const VERSION = "1.0.0";

// 브리지는 자식에 붙어 봐야 툴 목록을 안다. 툴 목록은 세션 시작 때 정해지므로
// 다 붙인 뒤에 서빙을 시작해야 한다.
export async function buildServer() {
  const server = new McpServer({ name: NAME, version: VERSION });
  for (const module of modules) await module.register(server);
  return server;
}
