import { store, backendName } from "../../shared/store/index.js";

const INDEX_FILE = "index.json";

const keyOf = (label) => `${label.replace(/[^a-zA-Z0-9._-]/g, "_")}.json`;

async function readIndex() {
  const raw = await (await store()).read(INDEX_FILE);
  if (raw === null) return null;
  const parsed = JSON.parse(raw);
  return Array.isArray(parsed.snapshots) ? parsed.snapshots : [];
}

// 색인이 없거나 손으로 넣은 파일이 있을 수 있다. 파일 목록을 진실로 보고 색인은 보조로 쓴다.
async function scanFiles() {
  const items = await (await store()).list();
  return items
    .filter((i) => i.key !== INDEX_FILE)
    .map((i) => ({ label: i.key.replace(/\.json$/, ""), savedAt: i.modifiedAt }));
}

export async function listEntries() {
  const [indexed, saved] = await Promise.all([readIndex(), scanFiles()]);
  const meta = new Map((indexed || []).map((e) => [e.label, e]));
  return saved
    .map((f) => ({ ...f, ...(meta.get(f.label) || {}) }))
    .sort((a, b) => a.savedAt.localeCompare(b.savedAt));
}

export async function listSnapshots() {
  return (await listEntries()).map((e) => e.label);
}

export async function saveSnapshot(label, spec, meta = {}) {
  const s = await store();
  const where = await s.write(keyOf(label), JSON.stringify(spec));

  const entry = { label, savedAt: new Date().toISOString() };
  for (const k of ["commit", "pr", "title"]) if (meta[k] != null && meta[k] !== "") entry[k] = meta[k];

  const rest = (await listEntries()).filter((e) => e.label !== label);
  await s.write(INDEX_FILE, JSON.stringify({ version: 1, snapshots: [...rest, entry] }, null, 2));
  return where;
}

export async function loadSnapshot(label) {
  const raw = await (await store()).read(keyOf(label));
  return raw === null ? null : JSON.parse(raw);
}

export { backendName };
