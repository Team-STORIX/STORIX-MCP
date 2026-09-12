import { readFile, writeFile, mkdir, readdir, stat } from "node:fs/promises";
import { homedir } from "node:os";
import path from "node:path";

const DIR =
  process.env.SWAGGER_SNAPSHOT_DIR || path.join(homedir(), ".storix-mcp", "swagger", "snapshots");

export const location = DIR;

export async function read(key) {
  try {
    return await readFile(path.join(DIR, key), "utf8");
  } catch (e) {
    if (e.code === "ENOENT") return null;
    throw e;
  }
}

export async function write(key, body) {
  await mkdir(DIR, { recursive: true });
  const file = path.join(DIR, key);
  await writeFile(file, body, "utf8");
  return file;
}

export async function list() {
  try {
    const names = await readdir(DIR);
    const out = [];
    for (const name of names) {
      if (!name.endsWith(".json")) continue;
      const s = await stat(path.join(DIR, name));
      out.push({ key: name, modifiedAt: s.mtime.toISOString() });
    }
    return out;
  } catch (e) {
    if (e.code === "ENOENT") return [];
    throw e;
  }
}
