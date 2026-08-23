import { eachOperation } from "./spec.js";
import { diffSpecs } from "./diff.js";
import { listEntries, loadSnapshot } from "./snapshots.js";

const UNIT_MS = { h: 3600_000, d: 86400_000, w: 604800_000 };
const MAX_SEGMENTS = 10;

// "3d", "2w", "12h", "2026-08-20" 를 받는다.
export function parseSince(since) {
  const m = /^(\d+)\s*([hdw])$/i.exec(since.trim());
  if (m) return Date.now() - Number(m[1]) * UNIT_MS[m[2].toLowerCase()];
  const t = Date.parse(since);
  return Number.isNaN(t) ? null : t;
}

function tagsOf(spec, method, path) {
  const op = spec.paths?.[path]?.[method.toLowerCase()];
  return op?.tags || [];
}

function opKeyParts(key) {
  const i = key.indexOf(" ");
  return { method: key.slice(0, i), path: key.slice(i + 1) };
}

function keeps(key, beforeSpec, afterSpec, { tag, path: pathFilter }) {
  const { method, path } = opKeyParts(key);
  if (pathFilter && path !== pathFilter) return false;
  if (!tag) return true;
  const tags = [...tagsOf(afterSpec, method, path), ...tagsOf(beforeSpec, method, path)];
  const want = tag.toLowerCase();
  return tags.some((t) => t.toLowerCase().includes(want));
}

function filterDiff(diff, beforeSpec, afterSpec, filters) {
  if (!filters.tag && !filters.path) return diff;
  return {
    added: diff.added.filter((k) => keeps(k, beforeSpec, afterSpec, filters)),
    removed: diff.removed.filter((k) => keeps(k, beforeSpec, afterSpec, filters)),
    changed: diff.changed.filter((c) => keeps(c.operation, beforeSpec, afterSpec, filters)),
  };
}

const isEmpty = (d) => !d.added.length && !d.removed.length && !d.changed.length;

// 스냅샷들을 시간순으로 늘어놓고 이웃끼리 비교한다. 마지막은 현재 dev와 비교한다.
export async function collectHistory({ since, tag, path, limit }, fetchSpec) {
  const entries = await listEntries();
  if (!entries.length) return { noSnapshots: true };

  const live = await fetchSpec({ force: true });
  const points = [
    ...entries.map((e) => ({ ...e, load: () => loadSnapshot(e.label) })),
    { label: "현재 dev", savedAt: new Date().toISOString(), live: true, load: async () => live },
  ];

  let pairs = [];
  for (let i = 1; i < points.length; i++) pairs.push({ from: points[i - 1], to: points[i] });

  let sinceMs = null;
  if (since) {
    sinceMs = parseSince(since);
    if (sinceMs === null) return { badSince: since };
    pairs = pairs.filter((p) => Date.parse(p.to.savedAt) >= sinceMs);
  } else {
    pairs = pairs.slice(-(limit || 1));
  }

  const dropped = Math.max(0, pairs.length - MAX_SEGMENTS);
  if (dropped) pairs = pairs.slice(-MAX_SEGMENTS);

  const filters = { tag, path };
  const segments = [];
  for (const pair of pairs.reverse()) {
    const [beforeSpec, afterSpec] = await Promise.all([pair.from.load(), pair.to.load()]);
    if (!beforeSpec || !afterSpec) continue;
    const diff = filterDiff(diffSpecs(beforeSpec, afterSpec), beforeSpec, afterSpec, filters);
    if (isEmpty(diff)) continue;
    segments.push({ from: pair.from, to: pair.to, diff });
  }

  return { segments, dropped, total: entries.length };
}

function when(iso) {
  const d = new Date(iso);
  const p = (n) => String(n).padStart(2, "0");
  return `${d.getMonth() + 1}/${d.getDate()} ${p(d.getHours())}:${p(d.getMinutes())}`;
}

function originOf(point) {
  const bits = [];
  if (point.pr) bits.push(`PR #${point.pr}`);
  if (point.commit) bits.push(String(point.commit).slice(0, 7));
  if (point.title) bits.push(point.title);
  return bits.length ? bits.join(" · ") : point.label;
}

function segmentLines(segment, lines) {
  const { diff } = segment;
  lines.push(`${when(segment.to.savedAt)}  ${originOf(segment.to)}`);

  for (const k of diff.added) lines.push(`  + ${k}  새 엔드포인트`);
  for (const k of diff.removed) lines.push(`  - ${k}  제거됨 (breaking)`);

  for (const c of diff.changed) {
    lines.push(`  ~ ${c.operation}`);
    for (const b of c.breaking) lines.push(`      [breaking] ${b}`);
    for (const n of c.notes) lines.push(`      ${n}`);
  }
  lines.push("");
}

export function formatHistory(result, { since, tag, path }) {
  if (result.noSnapshots) {
    return (
      "저장된 스냅샷이 없어 이력을 만들 수 없습니다.\n\n" +
      "이력은 배포 시점마다 찍힌 스냅샷을 이웃끼리 비교해 만듭니다. " +
      "지금은 아무도 찍지 않아 비교할 기준이 없습니다. " +
      "swagger_snapshot_spec으로 지금 시점을 하나 찍어두면 다음 배포부터 이력이 쌓입니다."
    );
  }
  if (result.badSince) {
    return `since 값 '${result.badSince}'를 못 읽었습니다. '3d', '2w', '12h' 또는 '2026-08-20' 형식으로 넣으세요.`;
  }

  const scope = [tag && `태그 '${tag}'`, path && path, since ? `${since} 이후` : "최근 배포"]
    .filter(Boolean)
    .join(" · ");

  if (!result.segments.length) return `${scope} — 변경 없음.`;

  const lines = [`${scope} — 변경 ${result.segments.length}건`, ""];
  for (const s of result.segments) segmentLines(s, lines);
  if (result.dropped) lines.push(`(오래된 구간 ${result.dropped}개는 생략했습니다. since를 좁히세요.)`);
  return lines.join("\n").trimEnd();
}
