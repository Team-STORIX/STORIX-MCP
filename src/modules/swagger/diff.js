import { eachOperation, expand, findOperation } from "./spec.js";

const MAX_DEPTH = 20;
const EXPAND_DEPTH = 24;

// springdoc은 content-type을 application/json이 아니라 */* 로 내보내는 경우가 많다.
// json을 우선하되 없으면 첫 번째 content를 쓴다.
function pickSchema(content) {
  if (!content) return null;
  const preferred = Object.keys(content).find((t) => t.includes("json"));
  const key = preferred ?? Object.keys(content)[0];
  return key ? content[key]?.schema ?? null : null;
}

function contentTypes(content) {
  return Object.keys(content || {}).sort();
}

// 에러 코드는 응답 예시의 키다. errors.js 가 읽는 자리와 같다.
// 상태코드만 비교하면 이미 403 이 있던 API 에 새 코드가 붙어도 드러나지 않는다.
function errorCodesOf(content) {
  for (const media of Object.values(content || {})) {
    if (media?.examples) return Object.keys(media.examples);
  }
  return [];
}

function diffErrorCodes(status, beforeContent, afterContent, notes) {
  const before = new Set(errorCodesOf(beforeContent));
  const after = new Set(errorCodesOf(afterContent));
  const added = [...after].filter((c) => !before.has(c));
  const removed = [...before].filter((c) => !after.has(c));
  if (added.length) notes.push(`응답 ${status} 에러코드 추가: ${added.sort().join(", ")}`);
  if (removed.length) notes.push(`응답 ${status} 에러코드 제거: ${removed.sort().join(", ")}`);
}

// 필드 하나의 모양. 경로만 모으면 userId: string → number 를 놓친다.
function shape(schema) {
  const s = schema || {};
  const type = Array.isArray(s.type) ? s.type.join("|") : s.type || (s.properties ? "object" : "?");
  // 스칼라 배열은 항목이 따로 잡히지 않으니 enum 값을 여기서 같이 보여준다.
  if (type === "array" && s.items && !s.items.properties) {
    return { type: `array<${shapeText(shape(s.items))}>`, format: null, enums: null, nullable: s.nullable === true };
  }
  return {
    type,
    format: s.format || null,
    enums: Array.isArray(s.enum) ? [...s.enum].map(String).sort() : null,
    nullable: s.nullable === true,
  };
}

// 설명은 비교값이 아니라 곁들이는 정보다. 길면 프론트가 볼 만큼만 자른다.
function docOf(schema) {
  const d = schema?.description;
  if (typeof d !== "string" || !d.trim()) return null;
  const first = d.trim().split(/[.。\n]/)[0].trim();
  return first.length > 44 ? `${first.slice(0, 44)}…` : first;
}

function shapeText(sh) {
  const parts = [sh.type];
  if (sh.format) parts.push(sh.format);
  if (sh.nullable) parts.push("nullable");
  if (sh.enums) parts.push(`enum(${sh.enums.join("|")})`);
  return parts.join(" ");
}

function fieldMap(schema, prefix = "", depth = 0, out = new Map()) {
  if (!schema || typeof schema !== "object") return out;
  // expand()가 순환·최대깊이에서 남긴 표시. 그 아래는 볼 수 없으니 잘렸다고만 적는다.
  if (schema.$circular || schema.$truncated || schema.$unresolved) {
    if (prefix) out.set(`${prefix}.…`, { shape: shape({ type: "잘림" }), required: false });
    return out;
  }
  if (depth > MAX_DEPTH) {
    if (prefix) out.set(`${prefix}.…`, { shape: shape({ type: "잘림" }), required: false });
    return out;
  }
  if (schema.type === "array" || schema.items) {
    return fieldMap(schema.items, `${prefix}[]`, depth + 1, out);
  }

  const required = new Set(Array.isArray(schema.required) ? schema.required : []);
  const properties = schema.properties;
  if (!properties || typeof properties !== "object") return out;

  for (const [name, sub] of Object.entries(properties)) {
    if (name.startsWith("$")) continue;
    const p = prefix ? `${prefix}.${name}` : name;
    out.set(p, { shape: shape(sub), required: required.has(name), desc: docOf(sub) });
    fieldMap(sub, p, depth + 1, out);
  }
  return out;
}

// side: "요청" | "응답". 같은 변화라도 방향에 따라 깨지는 쪽이 반대다.
function compareShape(label, side, before, after, breaking, notes) {
  const b = before.shape;
  const a = after.shape;

  if (b.type !== a.type) breaking.push(`${label} 타입 변경: ${b.type} → ${a.type}`);
  if (b.format !== a.format) notes.push(`${label} format 변경: ${b.format ?? "없음"} → ${a.format ?? "없음"}`);

  if (b.nullable !== a.nullable) {
    const becameNullable = !b.nullable && a.nullable;
    const line = `${label} nullable ${b.nullable} → ${a.nullable}`;
    // 응답이 널을 낼 수 있게 되거나, 요청이 널을 못 받게 되면 쓰던 쪽이 깨진다.
    if ((side === "응답" && becameNullable) || (side === "요청" && !becameNullable)) breaking.push(line);
    else notes.push(line);
  }

  if (b.enums || a.enums) {
    const bs = new Set(b.enums || []);
    const as = new Set(a.enums || []);
    const removed = [...bs].filter((v) => !as.has(v));
    const added = [...as].filter((v) => !bs.has(v));
    // 요청은 보내던 값이 막히면, 응답은 모르는 값이 오면 문제가 된다.
    if (removed.length) {
      const line = `${label} enum 값 제거: ${removed.join(", ")}`;
      side === "요청" ? breaking.push(line) : notes.push(line);
    }
    if (added.length) notes.push(`${label} enum 값 추가: ${added.join(", ")}`);
  }

  if (before.desc !== after.desc) notes.push(`${label} 설명 변경`);

  if (before.required !== after.required) {
    const line = `${label} ${after.required ? "필수로" : "선택으로"} 바뀜`;
    // 요청은 필수가 늘면, 응답은 필수가 줄면 쓰던 쪽이 깨진다.
    const breaks = side === "요청" ? after.required : before.required;
    breaks ? breaking.push(line) : notes.push(line);
  }
}

function diffFields(prefix, side, beforeSchema, afterSchema, breaking, notes) {
  const b = fieldMap(beforeSchema);
  const a = fieldMap(afterSchema);

  for (const [p, v] of a) {
    if (!b.has(p)) notes.push(`${prefix} 필드 추가: ${p} (${shapeText(v.shape)})`);
  }
  for (const p of b.keys()) {
    if (!a.has(p)) breaking.push(`${prefix} 필드 제거: ${p}`);
  }
  for (const [p, av] of a) {
    const bv = b.get(p);
    if (bv) compareShape(`${prefix} ${p}`, side, bv, av, breaking, notes);
  }
}

function paramMap(spec, op) {
  const out = new Map();
  for (const raw of op.parameters || []) {
    const p = expand(raw, spec, 0, new Set(), EXPAND_DEPTH);
    out.set(`${p.in}:${p.name}`, { shape: shape(p.schema), required: p.required === true });
  }
  return out;
}

function diffParams(before, after, breaking, notes) {
  for (const [k, v] of after) {
    if (before.has(k)) continue;
    const line = `파라미터 추가: ${k} (${shapeText(v.shape)})`;
    v.required ? breaking.push(`필수 ${line}`) : notes.push(line);
  }
  for (const k of before.keys()) {
    if (!after.has(k)) breaking.push(`파라미터 제거: ${k}`);
  }
  for (const [k, av] of after) {
    const bv = before.get(k);
    if (bv) compareShape(`파라미터 ${k}`, "요청", bv, av, breaking, notes);
  }
}

function securityText(spec, op) {
  const sec = op.security ?? spec.security;
  if (!sec) return "없음";
  return sec.flatMap((s) => Object.keys(s)).sort().join(", ") || "없음";
}

// STOMP 는 paths 에 없어 지금까지 diff 에 한 줄도 안 나갔다. BE 가 x-websocket 으로 실어 보낸다.
const WEBSOCKET_KEY = "STOMP /ws-stomp";

function destinationMap(contract) {
  return new Map((contract?.destinations ?? []).map((d) => [`${d.type} ${d.path}`, d]));
}

function errorCodeMap(contract) {
  return new Map((contract?.errorCodes ?? []).map((e) => [e.code, e]));
}

function diffWebsocket(beforeSpec, afterSpec) {
  const before = beforeSpec?.["x-websocket"];
  const after = afterSpec?.["x-websocket"];
  if (!before && !after) return null;

  const breaking = [];
  const notes = [];

  if (before && !after) {
    return { operation: WEBSOCKET_KEY, breaking: ["웹소켓 계약 제거"], notes };
  }
  if (!before && after) notes.push("웹소켓 계약 추가");

  const bDest = destinationMap(before);
  const aDest = destinationMap(after);
  for (const [key, d] of aDest) {
    if (bDest.has(key)) continue;
    notes.push(d.auth ? `목적지 추가: ${key} · ${d.auth}` : `목적지 추가: ${key}`);
  }
  for (const key of bDest.keys()) {
    if (!aDest.has(key)) breaking.push(`목적지 제거: ${key}`);
  }
  for (const [key, d] of aDest) {
    const prev = bDest.get(key);
    if (prev && prev.auth !== d.auth) {
      breaking.push(`목적지 권한 변경: ${key} · ${prev.auth ?? "없음"} → ${d.auth ?? "없음"}`);
    }
  }

  if (before && before.errorDestination !== after.errorDestination) {
    breaking.push(`에러 목적지 변경: ${before.errorDestination ?? "없음"} → ${after.errorDestination ?? "없음"}`);
  }

  const bReason = new Set(before?.errorReasons ?? []);
  const aReason = new Set(after.errorReasons ?? []);
  const addedReasons = [...aReason].filter((r) => !bReason.has(r));
  const removedReasons = [...bReason].filter((r) => !aReason.has(r));
  if (addedReasons.length) notes.push(`에러 사유 추가: ${addedReasons.sort().join(", ")}`);
  if (removedReasons.length) breaking.push(`에러 사유 제거: ${removedReasons.sort().join(", ")}`);

  const bCode = errorCodeMap(before);
  const aCode = errorCodeMap(after);
  const addedCodes = [...aCode.keys()].filter((c) => !bCode.has(c));
  const removedCodes = [...bCode.keys()].filter((c) => !aCode.has(c));
  if (addedCodes.length) notes.push(`에러코드 추가: ${addedCodes.sort().join(", ")}`);
  if (removedCodes.length) notes.push(`에러코드 제거: ${removedCodes.sort().join(", ")}`);
  for (const [code, e] of aCode) {
    const prev = bCode.get(code);
    if (prev && prev.reason !== e.reason) {
      notes.push(`에러 사유 변경: ${code} · ${prev.reason ?? "없음"} → ${e.reason ?? "없음"}`);
    }
  }

  if (!breaking.length && !notes.length) return null;
  return { operation: WEBSOCKET_KEY, breaking, notes };
}

export function diffSpecs(beforeSpec, afterSpec) {
  const key = (o) => `${o.method} ${o.path}`;
  const before = new Map(eachOperation(beforeSpec).map((o) => [key(o), o]));
  const after = new Map(eachOperation(afterSpec).map((o) => [key(o), o]));

  const added = [...after.keys()].filter((k) => !before.has(k));
  const removed = [...before.keys()].filter((k) => !after.has(k));
  const changed = [];

  for (const k of after.keys()) {
    if (!before.has(k)) continue;
    const bOp = before.get(k).op;
    const aOp = after.get(k).op;
    const breaking = [];
    const notes = [];

    diffParams(paramMap(beforeSpec, bOp), paramMap(afterSpec, aOp), breaking, notes);

    const bBody = expand(bOp.requestBody, beforeSpec, 0, new Set(), EXPAND_DEPTH)?.content;
    const aBody = expand(aOp.requestBody, afterSpec, 0, new Set(), EXPAND_DEPTH)?.content;
    diffFields("요청", "요청", pickSchema(bBody), pickSchema(aBody), breaking, notes);
    const bTypes = contentTypes(bBody).join(", ");
    const aTypes = contentTypes(aBody).join(", ");
    if (bTypes !== aTypes) notes.push(`요청 content-type 변경: ${bTypes || "없음"} → ${aTypes || "없음"}`);

    const bRes = bOp.responses || {};
    const aRes = aOp.responses || {};
    for (const code of new Set([...Object.keys(bRes), ...Object.keys(aRes)])) {
      if (!(code in aRes)) {
        breaking.push(`응답 ${code} 제거`);
        continue;
      }
      if (!(code in bRes)) {
        // 상태코드 자체가 새로 생긴 경우다. "응답 403 추가" 와 "403 에러코드 추가" 로 나누면
        // 같은 얘기가 두 줄을 차지한다. 코드 이름까지 한 줄에 담는다.
        const codes = errorCodesOf(expand(aRes[code], afterSpec, 0, new Set(), EXPAND_DEPTH)?.content);
        notes.push(codes.length ? `응답 ${code} 신규: ${codes.sort().join(", ")}` : `응답 ${code} 추가`);
        continue;
      }
      const bContent = expand(bRes[code], beforeSpec, 0, new Set(), EXPAND_DEPTH)?.content;
      const aContent = expand(aRes[code], afterSpec, 0, new Set(), EXPAND_DEPTH)?.content;
      diffFields(`응답 ${code}`, "응답", pickSchema(bContent), pickSchema(aContent), breaking, notes);
      diffErrorCodes(code, bContent, aContent, notes);
      const bt = contentTypes(bContent).join(", ");
      const at = contentTypes(aContent).join(", ");
      if (bt !== at) notes.push(`응답 ${code} content-type 변경: ${bt || "없음"} → ${at || "없음"}`);
    }

    const bSec = securityText(beforeSpec, bOp);
    const aSec = securityText(afterSpec, aOp);
    if (bSec !== aSec) breaking.push(`인증 요구 변경: ${bSec} → ${aSec}`);

    if (!bOp.deprecated && aOp.deprecated) notes.push("deprecated 표시됨");

    if (breaking.length || notes.length) changed.push({ operation: k, breaking, notes });
  }

  const websocket = diffWebsocket(beforeSpec, afterSpec);
  if (websocket) changed.push(websocket);

  return { added, removed, changed };
}

// "깨지나" 와 "할 일이 있나" 는 다른 질문이다. 필드가 늘거나 에러 코드가 붙으면 기존 앱은
// 안 깨지지만 프론트는 반드시 붙여야 한다. 그래서 둘을 따로 센다.
// 여기 적힌 문구는 모두 이 파일이 직접 만들어 내는 것들이다.
const ACTIONABLE = /(필드 추가|응답 \d+ (추가|신규)|에러코드 추가|enum 값 추가|파라미터 추가|목적지 추가|에러 사유 (추가|변경))/;

// 개수 세는 곳이 여러 군데면 곧 어긋난다. 한 곳에서만 센다.
export function summarize(beforeSpec, afterSpec) {
  const diff = diffSpecs(beforeSpec, afterSpec);
  const breakingOps = diff.changed.filter((c) => c.breaking.length);
  const actionableOps = diff.changed.filter(
    (c) => !c.breaking.length && c.notes.some((n) => ACTIONABLE.test(n))
  );
  return {
    diff,
    breaks: diff.removed.length + breakingOps.length,
    added: diff.added.length,
    actionable: actionableOps.length,
  };
}

export function formatDiff({ added, removed, changed }, beforeLabel, afterLabel) {
  const lines = [`# 스펙 diff: ${beforeLabel} → ${afterLabel}`, ""];
  const breakingOps = changed.filter((c) => c.breaking.length);

  if (!added.length && !removed.length && !changed.length) {
    lines.push("변경 없음.");
    return lines.join("\n");
  }

  lines.push(
    `추가 ${added.length}개 · 제거 ${removed.length}개 · 변경 ${changed.length}개 ` +
      `(이 중 호환성 깨짐 의심 ${breakingOps.length}개)`,
    ""
  );

  if (removed.length) {
    lines.push("## 제거된 엔드포인트 (breaking)");
    for (const k of removed) lines.push(`- ${k}`);
    lines.push("");
  }
  if (breakingOps.length) {
    lines.push("## 호환성 깨짐 의심");
    for (const c of breakingOps) {
      lines.push(`- ${c.operation}`);
      for (const b of c.breaking) lines.push(`  - ${b}`);
      // 깨지는 변경이 있는 엔드포인트라도 나머지 변경을 같이 봐야 한다.
      for (const n of c.notes) lines.push(`  - (그 외) ${n}`);
    }
    lines.push("");
  }
  if (added.length) {
    lines.push("## 추가된 엔드포인트");
    for (const k of added) lines.push(`- ${k}`);
    lines.push("");
  }

  const softOps = changed.filter((c) => !c.breaking.length && c.notes.length);
  if (softOps.length) {
    lines.push("## 그 외 변경");
    for (const c of softOps) {
      lines.push(`- ${c.operation}`);
      for (const n of c.notes) lines.push(`  - ${n}`);
    }
  }

  return lines.join("\n");
}

// ── 응답/요청 모양을 JSON 그대로 보여주는 렌더러 ──────────────────────────
// 필드 경로를 나열하면 프론트가 머릿속에서 JSON을 다시 조립해야 한다. 그냥 JSON으로 그린다.

function buildTree(map) {
  const root = { children: new Map() };
  for (const [path, v] of map) {
    let node = root;
    for (const seg of path.split(".")) {
      if (!node.children.has(seg)) node.children.set(seg, { children: new Map() });
      node = node.children.get(seg);
    }
    node.shape = v.shape;
    node.required = v.required;
    node.desc = v.desc;
  }
  return root;
}

const EMPTY = { children: new Map() };

function mergeTree(before, after) {
  const names = new Set([...before.children.keys(), ...after.children.keys()]);
  const out = [];
  for (const name of names) {
    const b = before.children.get(name);
    const a = after.children.get(name);
    const children = mergeTree(b || EMPTY, a || EMPTY);
    let status = "same";
    if (!b) status = "added";
    else if (!a) status = "removed";
    else if (b.shape && a.shape && shapeText(b.shape) !== shapeText(a.shape)) status = "changed";
    else if (b.required !== a.required) status = "changed";
    out.push({
      name,
      before: b,
      after: a,
      children,
      status,
      hasChange: status !== "same" || children.some((c) => c.hasChange),
    });
  }
  return out;
}

function valueOf(node, side, withDoc = false) {
  const src = side === "before" ? node.before : node.after;
  if (!src?.shape) return "…";
  const base = `${shapeText(src.shape)}${src.required ? " (필수)" : ""}`;
  return withDoc && src.desc ? `${base},   // ${src.desc}` : `${base},`;
}

function renderNodes(nodes, depth, lines, inherited) {
  const pad = "  ".repeat(depth);
  const shown = nodes.filter((n) => inherited || n.hasChange);
  const hidden = nodes.length - shown.length;

  for (const n of shown) {
    const status = inherited || n.status;
    const isArray = n.name.endsWith("[]");
    const key = `"${isArray ? n.name.slice(0, -2) : n.name}"`;
    const open = isArray ? "[{" : "{";
    const close = isArray ? "}]" : "}";

    const put = (mark, text) => lines.push(`${mark} ${pad}${text}`);

    if (n.children.length) {
      const mark = status === "added" ? "+" : status === "removed" ? "-" : " ";
      put(mark, `${key}: ${open}`);
      renderNodes(n.children, depth + 1, lines, status === "same" ? null : status);
      put(mark, `${close},`);
      continue;
    }

    if (status === "changed") {
      put("-", `${key}: ${valueOf(n, "before")}`);
      put("+", `${key}: ${valueOf(n, "after", true)}`);
    } else if (status === "removed") {
      put("-", `${key}: ${valueOf(n, "before")}`);
    } else if (status === "added") {
      put("+", `${key}: ${valueOf(n, "after", true)}`);
    } else {
      put(" ", `${key}: ${valueOf(n, "after")}`);
    }
  }

  if (hidden) lines.push(`  ${pad}… 그대로인 필드 ${hidden}개`);
}

export function renderJsonDiff(beforeSchema, afterSchema) {
  const nodes = mergeTree(buildTree(fieldMap(beforeSchema)), buildTree(fieldMap(afterSchema)));
  if (!nodes.some((n) => n.hasChange)) return null;
  const lines = ["  {"];
  renderNodes(nodes, 1, lines, null);
  lines.push("  }");
  return lines;
}

// ── 터미널·PR 코멘트 공용 변경 리포트 ────────────────────────────────────
// 프론트는 VS Code 터미널에서 본다. 마크다운 헤딩 대신 구분선과 +/- 로 눈에 띄게 한다.

const RULE = "─".repeat(64);

function responseSchema(spec, method, path, code) {
  const op = findOperation(spec, method, path)?.op;
  if (!op) return null;
  const content = expand(op.responses?.[code], spec, 0, new Set(), EXPAND_DEPTH)?.content;
  return content ? pickSchema(content) : null;
}

function requestSchema(spec, method, path) {
  const op = findOperation(spec, method, path)?.op;
  if (!op) return null;
  const content = expand(op.requestBody, spec, 0, new Set(), EXPAND_DEPTH)?.content;
  return content ? pickSchema(content) : null;
}

function summaryOf(spec, method, path) {
  return findOperation(spec, method, path)?.op?.summary || "";
}

function opBlock(beforeSpec, afterSpec, entry, lines, { skipHeader = false } = {}) {
  const [method, path] = entry.operation.split(" ");
  if (!skipHeader) {
    const warn = entry.breaking.length ? "⚠ " : "  ";
    lines.push(`${warn}${method} ${path}`);
    const summary = summaryOf(afterSpec, method, path);
    if (summary) lines.push(`  ${summary}`);
    lines.push("");
  }

  const reqDiff = renderJsonDiff(requestSchema(beforeSpec, method, path), requestSchema(afterSpec, method, path));
  if (reqDiff) {
    lines.push("  요청 바디");
    lines.push(...reqDiff, "");
  }

  const codes = new Set();
  for (const line of [...entry.breaking, ...entry.notes]) {
    const m = line.match(/^응답 (\d+)/);
    if (m) codes.add(m[1]);
  }
  for (const code of [...codes].sort()) {
    const d = renderJsonDiff(
      responseSchema(beforeSpec, method, path, code),
      responseSchema(afterSpec, method, path, code)
    );
    if (!d) continue;
    lines.push(`  응답 ${code}`);
    lines.push(...d, "");
  }

  // JSON으로 안 드러나는 것들 (파라미터, 인증, content-type)
  const rest = [...entry.breaking, ...entry.notes].filter((l) => !/^(요청|응답 \d+) /.test(l));
  for (const r of rest) lines.push(`  · ${r}`);
  if (rest.length) lines.push("");
}


// 같은 DTO를 여러 응답이 물고 있으면 똑같은 변경이 N번 나온다. 경로 앞부분을 지운
// 서명으로 묶어서 한 번만 보여준다.
function changeSignature(entry) {
  const norm = (line) =>
    line.replace(/((?:요청|응답 \d+) [^:]*: )([\w.\[\]]+)/, (_, head, path) => {
      const segs = path.split(".");
      return head + segs.slice(-2).join(".");
    });
  return [...entry.breaking, ...entry.notes].map(norm).sort().join("\n");
}

function fieldPathsOf(entry) {
  const out = [];
  for (const line of [...entry.breaking, ...entry.notes]) {
    const m = line.match(/(?:요청|응답 \d+) [^:]*: ([\w.\[\]]+)/);
    if (m) out.push(m[1]);
  }
  return out;
}

function groupEntries(entries) {
  const byKey = new Map();
  for (const e of entries) {
    const k = changeSignature(e);
    if (!byKey.has(k)) byKey.set(k, []);
    byKey.get(k).push(e);
  }
  return [...byKey.values()];
}

function groupBlock(beforeSpec, afterSpec, group, lines) {
  const [head, ...rest] = group;
  const warn = head.breaking.length ? "⚠ " : "  ";
  lines.push(`${warn}같은 변경 ${group.length}개 엔드포인트`);
  lines.push("");
  for (const c of group) {
    const [method, path] = c.operation.split(" ");
    const where = fieldPathsOf(c).join(", ");
    lines.push(`  ${method} ${path}${where ? `   ${where}` : ""}`);
  }
  lines.push("");
  lines.push(`  대표 응답 · ${head.operation}`);
  opBlock(beforeSpec, afterSpec, head, lines, { skipHeader: true });
}

// ── 슬랙용 압축 본문 ────────────────────────────────────────────────────
// 상세 리포트는 CloudWatch·터미널에서 본다. 슬랙에는 "어느 도메인의 무엇이 바뀌었나"만 담는다.

const MAX_SUB_LINES = 6;
// 슬랙은 섹션 블록을 여러 개 받는다. 한 블록에 우겨넣다 자르지 말고 나눠 싣는다.
const MAX_SLACK_BODY = 9000;

// 메서드는 코드블록 밖에 둔다. 경로만 감싸야 눈에 들어온다.
// 수정이 기본이라 표시하지 않고, 성격이 다른 신규·삭제만 앞에 붙인다.
function opLine(spec, key, kind) {
  const [method, path] = key.split(" ");
  const summary = summaryOf(spec, method, path);
  return `${kind ? `${kind} ` : ""}${method} \`${path}\`${summary ? `  ${summary}` : ""}`;
}

function tagOf(spec, key) {
  if (key === WEBSOCKET_KEY) return "웹소켓";
  const [method, path] = key.split(" ");
  return findOperation(spec, method, path)?.op?.tags?.[0] || "기타";
}

// 태그에 이미 대괄호가 들어 있는 것들이 있다. 덧씌우면 [[+] 탭] 이 된다.
function tagLabel(tag) {
  return /^\[.*\]$/.test(tag) ? `*${tag}*` : `*[${tag}]*`;
}

function push(groups, tag, block) {
  if (!groups.has(tag)) groups.set(tag, []);
  groups.get(tag).push(block);
}

// 같은 DTO 를 여러 응답이 물면 똑같은 변경이 수십 번 나온다. 상세 리포트가 쓰는
// 묶기를 여기서도 쓴다. isAdultOnly 같은 공통 필드 추가가 26줄이 되는 걸 막는다.
// 예산이 모자라면 무엇을 버리느냐가 중요하다. 깨지는 것과 에러 코드가 먼저 남아야 한다.
// 필드가 늘어난 목록보다 "이 API 가 403 으로 막힌다" 가 프론트에 급하다.
// 상태코드가 새로 생긴 줄도 에러 코드를 품고 있으므로 같은 급으로 본다.
const ERROR_CODE = /(에러코드 (추가|제거)|응답 \d+ 신규)/;

function rank(entry) {
  if (entry.breaking.length) return 0;
  if (entry.notes.some((n) => ERROR_CODE.test(n))) return 1;
  return 2;
}

// 엔드포인트 안에서도 같은 순서를 지킨다. 필드가 늘어난 줄보다 에러코드가 먼저다.
function subRank(line) {
  if (ERROR_CODE.test(line)) return 0;
  if (/응답 \d+ 추가|파라미터 추가/.test(line)) return 1;
  return 2;
}

function changedBlocks(afterSpec, changed) {
  const blocks = [];
  for (const group of groupEntries(changed)) {
    const head = group[0];
    const detail = [...head.breaking, ...head.notes.filter((n) => ACTIONABLE.test(n))];
    const mark = head.breaking.length ? ":rotating_light: " : "";
    const lines = [];

    const tags = [...new Set(group.map((c) => tagOf(afterSpec, c.operation)))];

    if (group.length > 1) {
      lines.push(`${mark}같은 변경 ${group.length}곳`);
      for (const c of group) {
        const [m, p] = c.operation.split(" ");
        lines.push(`        ${m} \`${p}\``);
      }
    } else {
      lines.push(`${mark}${opLine(afterSpec, head.operation, "")}`);
    }

    // 줄 수가 넘치면 접히는데, 접히는 쪽이 에러코드면 정작 급한 걸 못 본다. 먼저 올린다.
    const ordered = [...detail].sort((a, b) => subRank(a) - subRank(b));
    for (const d of ordered.slice(0, MAX_SUB_LINES)) lines.push(`        • ${d}`);
    if (ordered.length > MAX_SUB_LINES) {
      lines.push(`        • (상세 ${ordered.length - MAX_SUB_LINES}줄 더 있음)`);
    }

    // 묶음이 여러 태그에 걸치면 어느 한 태그 밑에 두면 오해가 된다. 따로 모은다.
    blocks.push({ tag: tags.length > 1 ? "여러 도메인 공통" : tags[0], rank: rank(head), lines });
  }
  return blocks;
}

export function formatSlackBody(beforeSpec, afterSpec) {
  const { added, removed, changed } = diffSpecs(beforeSpec, afterSpec);

  const blocks = [];
  for (const key of removed) {
    blocks.push({ tag: tagOf(beforeSpec, key), rank: 0, lines: [`:rotating_light: ${opLine(beforeSpec, key, "(삭제)")}`] });
  }
  for (const key of added) {
    blocks.push({ tag: tagOf(afterSpec, key), rank: 1, lines: [opLine(afterSpec, key, "(신규)")] });
  }
  blocks.push(...changedBlocks(afterSpec, changed));

  // 중요한 것부터 예산을 쓴다. 담기로 한 것만 태그별로 다시 모아 출력한다.
  const kept = new Map();
  let used = 0;
  let dropped = 0;
  let droppedErrorCodes = 0;

  for (const b of [...blocks].sort((x, y) => x.rank - y.rank)) {
    const cost = b.lines.join("\n").length + b.tag.length + 6;
    if (used + cost > MAX_SLACK_BODY) {
      dropped++;
      if (b.rank <= 1) droppedErrorCodes++;
      continue;
    }
    if (!kept.has(b.tag)) kept.set(b.tag, []);
    kept.get(b.tag).push(b.lines);
    used += cost;
  }

  const out = [];
  for (const [tag, list] of [...kept].sort((a, b) => a[0].localeCompare(b[0]))) {
    out.push([tagLabel(tag), ...list.flat(), ""].join("\n"));
  }
  if (dropped) {
    const extra = droppedErrorCodes ? ` (깨짐·에러코드 ${droppedErrorCodes}건 포함)` : "";
    out.push(`… 그 외 ${dropped}건 생략${extra}. 전체는 \`swagger_diff_spec\` 으로 보세요.`);
  }
  return out.join("\n").trimEnd();
}

export function formatChangelog(beforeSpec, afterSpec, meta = {}) {
  const { added, removed, changed } = diffSpecs(beforeSpec, afterSpec);
  const breakingOps = changed.filter((c) => c.breaking.length);
  const softOps = changed.filter((c) => !c.breaking.length);
  const needsWork = breakingOps.length + removed.length;

  const lines = [];
  lines.push(`━━━ API 스펙 변경${meta.pr ? ` · #${meta.pr}` : ""} ${"━".repeat(40)}`);
  if (meta.title) lines.push(meta.title);
  const stamp = [meta.env, meta.at, meta.author && `@${meta.author}`, meta.sha].filter(Boolean).join(" · ");
  if (stamp) lines.push(stamp);
  lines.push("");
  lines.push(`프론트 수정 필요 ${needsWork} · 신규 ${added.length} · 그 외 ${softOps.length}`);

  if (!needsWork && !added.length && !softOps.length) {
    lines.push("", "스펙 변경 없음.");
    return lines.join("\n");
  }

  if (removed.length) {
    lines.push("", RULE, "");
    for (const k of removed) lines.push(`⚠ ${k}  삭제됨`);
  }

  for (const g of groupEntries(breakingOps)) {
    lines.push("", RULE, "");
    g.length > 1 ? groupBlock(beforeSpec, afterSpec, g, lines) : opBlock(beforeSpec, afterSpec, g[0], lines);
  }

  if (added.length) {
    lines.push("", RULE, "", "신규 엔드포인트");
    for (const k of added) {
      const [method, path] = k.split(" ");
      const summary = summaryOf(afterSpec, method, path);
      lines.push("", `+ ${method} ${path}`);
      if (summary) lines.push(`  ${summary}`);
      const shape = renderJsonDiff(null, responseSchema(afterSpec, method, path, "200"));
      if (shape) lines.push(...shape);
    }
  }

  for (const g of groupEntries(softOps)) {
    lines.push("", RULE, "");
    g.length > 1 ? groupBlock(beforeSpec, afterSpec, g, lines) : opBlock(beforeSpec, afterSpec, g[0], lines);
  }

  return lines.join("\n").replace(/\n{3,}/g, "\n\n").trimEnd();
}
