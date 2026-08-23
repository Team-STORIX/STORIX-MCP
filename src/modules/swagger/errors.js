import { eachOperation, expand } from "./spec.js";

const OK_STATUS = /^2\d\d$/;

// 응답 예시에 코드·메시지가 들어 있다. 예시가 없으면 설명 문구라도 건진다.
function examplesOf(spec, body) {
  const content = expand(body, spec)?.content;
  if (!content) return null;
  for (const media of Object.values(content)) if (media?.examples) return media.examples;
  return null;
}

export function collectErrors(spec) {
  const byCode = new Map();

  for (const { method, path, op } of eachOperation(spec)) {
    const key = `${method} ${path}`;
    const tags = op.tags || [];

    for (const [status, body] of Object.entries(op.responses || {})) {
      if (OK_STATUS.test(status)) continue;
      const examples = examplesOf(spec, body);

      if (!examples) {
        // 예시가 없는 응답. 코드를 모르니 상태값으로만 남긴다.
        const code = `(코드 미상 ${status})`;
        const entry = byCode.get(code) || { code, status, message: body.description || "", ops: [], tags: new Set() };
        entry.ops.push(key);
        tags.forEach((t) => entry.tags.add(t));
        byCode.set(code, entry);
        continue;
      }

      for (const [code, example] of Object.entries(examples)) {
        const message = example?.value?.message || example?.summary || "";
        const entry = byCode.get(code) || { code, status, message, ops: [], tags: new Set() };
        if (!entry.message) entry.message = message;
        entry.ops.push(key);
        tags.forEach((t) => entry.tags.add(t));
        byCode.set(code, entry);
      }
    }
  }

  return byCode;
}

// info.description 안의 표에서 공통 에러를 읽는다. 개별 API 응답에는 안 실려 있는 것들이다.
export function commonErrors(spec) {
  const description = spec.info?.description || "";
  const out = [];
  let section = "";

  for (const line of description.split("\n")) {
    const heading = /^#{2,3}\s*(.+?)\s*$/.exec(line);
    if (heading) {
      section = heading[1];
      continue;
    }
    const row = /^\|\s*(\d{3})\s*\|\s*`([A-Z0-9_]+)`\s*\|\s*(.*?)\s*\|\s*$/.exec(line);
    if (row) out.push({ status: row[1], code: row[2], message: row[3], section });
  }
  return out;
}

// 코드 길이가 제각각이라 폭을 그때그때 잰다. 안 그러면 긴 코드에서 메시지가 붙는다.
function liner(entries) {
  const width = Math.max(0, ...entries.map((e) => e.code.length)) + 2;
  return (e) => `  ${String(e.status).padEnd(4)}${e.code.padEnd(width)}${e.message}`;
}

function byStatusThenCode(a, b) {
  return String(a.status).localeCompare(String(b.status)) || a.code.localeCompare(b.code);
}

export function renderForOperation(spec, entries, opKey, common) {
  const mine = entries.filter((e) => e.ops.includes(opKey)).sort(byStatusThenCode);
  const line = liner([...mine, ...common]);

  const lines = [opKey, ""];
  if (!mine.length) lines.push("  이 엔드포인트에만 해당하는 에러는 없습니다.");
  else lines.push(...mine.map(line));

  lines.push("", "공통 (인증이 필요한 모든 API에서 나갈 수 있음)");
  lines.push(...common.sort(byStatusThenCode).map(line));
  return lines.join("\n");
}

export function renderByCode(entries, code) {
  const hit = entries.filter((e) => e.code.toUpperCase().includes(code.toUpperCase()));
  if (!hit.length) return `'${code}' 에 해당하는 에러 코드가 스펙에 없습니다.`;

  const lines = [];
  for (const e of hit.sort(byStatusThenCode)) {
    lines.push(`${e.code}  (${e.status})  ${e.message}`);
    lines.push(`  나가는 곳 ${e.ops.length}개`);
    for (const op of e.ops.slice(0, 20)) lines.push(`    ${op}`);
    if (e.ops.length > 20) lines.push(`    … 그 외 ${e.ops.length - 20}개`);
    lines.push("");
  }
  return lines.join("\n").trimEnd();
}

export function renderList(entries, { tag, common }) {
  const scoped = tag
    ? entries.filter((e) => [...e.tags].some((t) => t.toLowerCase().includes(tag.toLowerCase())))
    : entries;

  if (!scoped.length) return `태그 '${tag}' 에 해당하는 에러가 없습니다.`;

  const line = liner([...scoped, ...(tag ? [] : common)]);
  const lines = [
    tag ? `태그 '${tag}' 에러 ${scoped.length}개` : `에러 코드 ${scoped.length}개`,
    "",
    ...scoped.sort(byStatusThenCode).map(line),
  ];

  if (!tag) {
    lines.push("", `공통 ${common.length}개 (개별 API 응답에는 안 실림)`, ...common.sort(byStatusThenCode).map(line));
  }
  return lines.join("\n");
}
