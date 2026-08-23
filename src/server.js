import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { modules } from "./modules/index.js";

export const NAME = "storix";
export const VERSION = "1.0.0";

export function buildServer() {
  const server = new McpServer({ name: NAME, version: VERSION });
  for (const module of modules) module.register(server);
  return server;
}
