import { readFile, writeFile, appendFile } from "node:fs/promises";
import path from "node:path";

export const FILE_NAME = ".storix-mcp.json";

// 서버는 작업 중인 프로젝트 폴더에서 실행된다. 자격증명은 그 폴더에 둔다.
export function homeDir() {
  return process.env.STORIX_MCP_HOME || process.cwd();
}

export function credentialsPath() {
  return path.join(homeDir(), FILE_NAME);
}

export async function readCredentials() {
  try {
    return JSON.parse(await readFile(credentialsPath(), "utf8"));
  } catch (e) {
    if (e.code === "ENOENT") return {};
    throw new Error(`${credentialsPath()} 를 읽지 못했습니다: ${e.message}`);
  }
}

export async function writeCredentials(next) {
  await writeFile(credentialsPath(), JSON.stringify(next, null, 2) + "\n", "utf8");
  return credentialsPath();
}

// 자격증명 파일이 커밋되면 안 된다. 없으면 만들어서라도 넣는다.
export async function ensureIgnored() {
  const file = path.join(homeDir(), ".gitignore");
  let body = "";
  try {
    body = await readFile(file, "utf8");
  } catch (e) {
    if (e.code !== "ENOENT") throw e;
  }

  const lines = body.split("\n").map((l) => l.trim());
  if (lines.includes(FILE_NAME)) return { file, added: false };

  const prefix = body === "" || body.endsWith("\n") ? "" : "\n";
  await appendFile(file, `${prefix}${FILE_NAME}\n`, "utf8");
  return { file, added: true };
}
