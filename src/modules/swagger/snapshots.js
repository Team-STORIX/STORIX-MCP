import { readFile, writeFile, mkdir, readdir, stat } from "node:fs/promises";
import { homedir } from "node:os";
import path from "node:path";

const SNAPSHOT_DIR =
  process.env.SWAGGER_SNAPSHOT_DIR || path.join(homedir(), ".storix-mcp", "swagger", "snapshots");

const INDEX_FILE = "index.json";

function snapshotPath(label) {
  const safe = label.replace(/[^a-zA-Z0-9._-]/g, "_");
  return path.join(SNAPSHOT_DIR, `${safe}.json`);
}

async function readIndex() {
  try {
    const raw = JSON.parse(await readFile(path.join(SNAPSHOT_DIR, INDEX_FILE), "utf8"));
    return Array.isArray(raw.snapshots) ? raw.snapshots : [];
  } catch (e) {
    if (e.code === "ENOENT") return null;
    throw e;
  }
}

// 색인이 없거나 손으로 넣은 파일이 있을 수 있다. 파일 목록을 진실로 보고 색인은 보조로 쓴다.
async function scanFiles() {
  try {
    const files = await readdir(SNAPSHOT_DIR);
    const out = [];
    for (const f of files) {
      if (!f.endsWith(".json") || f === INDEX_FILE) continue;
      const s = await stat(path.join(SNAPSHOT_DIR, f));
      out.push({ label: f.replace(/\.json$/, ""), savedAt: s.mtime.toISOString() });
    }
    return out;
  } catch (e) {
    if (e.code === "ENOENT") return [];
    throw e;
  }
}

export async function listEntries() {
  const [indexed, onDisk] = await Promise.all([readIndex(), scanFiles()]);
  const meta = new Map((indexed || []).map((e) => [e.label, e]));
  return onDisk
    .map((f) => ({ ...f, ...(meta.get(f.label) || {}) }))
    .sort((a, b) => a.savedAt.localeCompare(b.savedAt));
}

export async function listSnapshots() {
  return (await listEntries()).map((e) => e.label);
}

export async function saveSnapshot(label, spec, meta = {}) {
  await mkdir(SNAPSHOT_DIR, { recursive: true });
  const file = snapshotPath(label);
  await writeFile(file, JSON.stringify(spec), "utf8");

  const entry = { label, savedAt: new Date().toISOString() };
  for (const k of ["commit", "pr", "title"]) if (meta[k] != null && meta[k] !== "") entry[k] = meta[k];

  const rest = (await listEntries()).filter((e) => e.label !== label);
  await writeFile(
    path.join(SNAPSHOT_DIR, INDEX_FILE),
    JSON.stringify({ version: 1, snapshots: [...rest, entry] }, null, 2),
    "utf8"
  );
  return file;
}

export async function loadSnapshot(label) {
  try {
    return JSON.parse(await readFile(snapshotPath(label), "utf8"));
  } catch (e) {
    if (e.code === "ENOENT") return null;
    throw e;
  }
}
