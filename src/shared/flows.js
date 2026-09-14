import { readdir, readFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

const DEFAULT_DIR = fileURLToPath(new URL("../../flows/", import.meta.url));

export const FLOWS_DIR = process.env.STORIX_FLOWS_DIR || DEFAULT_DIR;

export async function listFlows() {
  let names;
  try {
    names = await readdir(FLOWS_DIR);
  } catch {
    return [];
  }
  return names.filter((n) => n.endsWith(".md")).map((n) => n.replace(/\.md$/, "")).sort();
}

export async function readFlow(name) {
  const file = path.join(FLOWS_DIR, `${name}.md`);
  let body;
  try {
    body = await readFile(file, "utf8");
  } catch {
    throw new Error(`${name} 시나리오를 못 찾았습니다 (${file}).`);
  }
  const title = (body.match(/^#\s+(.+)$/m) || [])[1] || name;
  const block = body.match(/```ya?ml\n([\s\S]*?)```/);
  if (!block) throw new Error(`${name}.md 에 yaml 블록이 없습니다.`);
  return { name, file, title, steps: parseSteps(block[1]) };
}

// 시나리오에 쓰는 만큼만 읽는다. steps 목록, 한 줄짜리 "키: 값", 인라인 맵과 목록.
// 벗어나는 문법은 조용히 넘기지 않고 줄 번호와 함께 알린다.
export function parseSteps(text) {
  const steps = [];
  let current = null;
  let seenHeader = false;

  text.split("\n").forEach((raw, i) => {
    const at = () => `${i + 1}번째 줄`;
    const line = raw.replace(/\s+#.*$/, "").trimEnd();
    if (!line.trim()) return;

    if (!seenHeader) {
      if (line.trim() !== "steps:") throw new Error(`${at()}: steps: 로 시작해야 합니다.`);
      seenHeader = true;
      return;
    }

    const item = line.match(/^\s*-\s+(.*)$/);
    if (item) {
      current = {};
      steps.push(current);
      assign(current, item[1], at);
      return;
    }
    if (!current) throw new Error(`${at()}: "- " 로 시작하는 스텝 안에 있어야 합니다.`);
    assign(current, line.trim(), at);
  });

  if (!steps.length) throw new Error("스텝이 하나도 없습니다.");
  return steps;
}

function assign(target, piece, at) {
  const m = piece.match(/^([A-Za-z_][\w-]*):\s*(.*)$/);
  if (!m) throw new Error(`${at()}: "키: 값" 형태여야 합니다.`);
  target[m[1]] = parseValue(m[2], at);
}

function parseValue(raw, at) {
  const v = raw.trim();
  if (v === "") throw new Error(`${at()}: 값이 비었습니다.`);

  if (v.startsWith("{") && v.endsWith("}")) {
    const out = {};
    for (const part of splitTop(v.slice(1, -1))) {
      if (!part.trim()) continue;
      const m = part.match(/^\s*([^:]+):\s*(.*)$/);
      if (!m) throw new Error(`${at()}: 인라인 맵은 "키: 값" 이어야 합니다.`);
      out[unquote(m[1].trim())] = parseValue(m[2], at);
    }
    return out;
  }
  if (v.startsWith("[") && v.endsWith("]")) {
    return splitTop(v.slice(1, -1))
      .filter((s) => s.trim())
      .map((s) => parseValue(s, at));
  }
  if (/^".*"$/.test(v) || /^'.*'$/.test(v)) return v.slice(1, -1);
  if (/^-?\d+(\.\d+)?$/.test(v)) return Number(v);
  if (v === "true" || v === "false") return v === "true";
  return v;
}

function splitTop(s) {
  const out = [];
  let depth = 0;
  let quote = null;
  let buf = "";
  for (const ch of s) {
    if (quote) {
      buf += ch;
      if (ch === quote) quote = null;
      continue;
    }
    if (ch === '"' || ch === "'") {
      quote = ch;
      buf += ch;
      continue;
    }
    if (ch === "{" || ch === "[") depth++;
    if (ch === "}" || ch === "]") depth--;
    if (ch === "," && depth === 0) {
      out.push(buf);
      buf = "";
      continue;
    }
    buf += ch;
  }
  out.push(buf);
  return out;
}

const unquote = (s) => (/^".*"$/.test(s) || /^'.*'$/.test(s) ? s.slice(1, -1) : s);
