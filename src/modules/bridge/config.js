import { readFile } from "node:fs/promises";
import { credentialsPath } from "../auth/credentials.js";

// 자식 목록은 자격증명과 같은 파일에 둔다. 그 파일은 .gitignore 에 있고 package.json 의
// files 에도 없어서, 각자 붙인 로컬 MCP 가 저장소나 npm 으로 새 나가지 않는다.
export async function readChildren() {
  let raw;
  try {
    raw = JSON.parse(await readFile(credentialsPath(), "utf8"));
  } catch (e) {
    if (e.code === "ENOENT") return [];
    throw new Error(`${credentialsPath()} 를 읽지 못했습니다: ${e.message}`);
  }

  const list = raw.bridge;
  if (!Array.isArray(list)) return [];

  return list
    .filter((c) => c && typeof c.alias === "string" && typeof c.command === "string")
    .map((c) => ({
      alias: c.alias,
      command: c.command,
      args: Array.isArray(c.args) ? c.args : [],
      env: c.env && typeof c.env === "object" ? c.env : {},
    }));
}

export { credentialsPath };
