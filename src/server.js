import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { modules } from "./modules/index.js";

export const NAME = "storix";
export const VERSION = "1.0.0";

// local=false는 여러 사람이 함께 쓰는 원격 모드다. 개인 자격증명을 다루는 기능은 그때 꺼진다.
// 브리지는 자식에 붙어 봐야 툴 목록을 안다. 툴 목록은 세션 시작 때 정해지므로
// 다 붙인 뒤에 서빙을 시작해야 한다.
export async function buildServer({ local = true } = {}) {
  const server = new McpServer({ name: NAME, version: VERSION });
  for (const module of modules) await module.register(server, { local });
  return server;
}
