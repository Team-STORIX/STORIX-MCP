import { expand, findOperation } from "../swagger/spec.js";

// "a.b.0.c" 로 값을 꺼낸다. "|" 로 후보를 여러 개 줄 수 있다.
export function pick(json, path) {
  for (const candidate of String(path).split("|")) {
    let node = json;
    for (const seg of candidate.trim().split(".")) {
      if (node == null) break;
      node = Array.isArray(node) ? node[Number(seg)] : node[seg];
    }
    if (node !== undefined && node !== null) return node;
  }
  return undefined;
}

// 응답 최상위만 본다. 깊이 들어가면 스펙 표현 차이로 헛걸림이 는다.
export function compareWithSpec(spec, method, path, status, json) {
  const found = findOperation(spec, method, path);
  if (!found) return { unknown: true };

  const res = found.op.responses?.[String(status)] || found.op.responses?.default;
  const content = res?.content?.["application/json"] || Object.values(res?.content || {})[0];
  if (!content?.schema || json === null || typeof json !== "object") return {};

  const schema = expand(content.schema, spec);
  if (!schema.properties) return {};

  return {
    missing: (schema.required || []).filter((k) => !(k in json)),
    extra: Object.keys(json).filter((k) => !(k in schema.properties)),
  };
}

export function fill(value, vars) {
  if (typeof value === "string") {
    return value.replace(/\{(\w+)\}/g, (whole, key) => (key in vars ? String(vars[key]) : whole));
  }
  if (Array.isArray(value)) return value.map((v) => fill(v, vars));
  if (value && typeof value === "object") {
    return Object.fromEntries(Object.entries(value).map(([k, v]) => [k, fill(v, vars)]));
  }
  return value;
}
