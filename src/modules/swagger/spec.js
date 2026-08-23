const BASE_URL = (process.env.SWAGGER_BASE_URL || "https://dev.storix.kr").replace(/\/$/, "");
const SPEC_PATH = process.env.SWAGGER_SPEC_PATH || "/v3/api-docs";
const SWAGGER_USER = process.env.SWAGGER_USER || "";
const SWAGGER_PASSWORD = process.env.SWAGGER_PASSWORD || "";
const TTL_MS = Number(process.env.SWAGGER_CACHE_TTL_MS || 60_000);

export const config = { BASE_URL, SPEC_PATH };

let cache = { spec: null, fetchedAt: 0 };

function basicAuthHeader() {
  if (!SWAGGER_USER) return null;
  const raw = `${SWAGGER_USER}:${SWAGGER_PASSWORD}`;
  return `Basic ${Buffer.from(raw, "utf8").toString("base64")}`;
}

export async function fetchSpec({ force = false } = {}) {
  if (!force && cache.spec && Date.now() - cache.fetchedAt < TTL_MS) return cache.spec;

  const url = `${BASE_URL}${SPEC_PATH}`;
  const headers = { Accept: "application/json" };
  const auth = basicAuthHeader();
  if (auth) headers.Authorization = auth;

  const res = await fetch(url, { headers });

  if (res.status === 401) {
    throw new Error(
      `${url} 인증 실패 (401). SWAGGER_USER / SWAGGER_PASSWORD 환경변수를 확인하세요.`
    );
  }
  if (!res.ok) {
    throw new Error(`${url} 조회 실패: HTTP ${res.status} ${res.statusText}`);
  }

  const spec = await res.json();
  cache = { spec, fetchedAt: Date.now() };
  return spec;
}

const MAX_DEPTH = 8;

// $ref를 실제 스키마로 펼친다. 순환 참조는 표시만 남기고 멈춘다.
export function expand(node, spec, depth = 0, seen = new Set(), maxDepth = MAX_DEPTH) {
  if (node === null || typeof node !== "object") return node;
  if (depth > maxDepth) return { $truncated: "최대 깊이 초과" };

  if (typeof node.$ref === "string") {
    const ref = node.$ref;
    if (seen.has(ref)) return { $circular: ref.split("/").pop() };
    const target = resolveRef(ref, spec);
    if (!target) return { $unresolved: ref };
    return expand(target, spec, depth + 1, new Set([...seen, ref]), maxDepth);
  }

  if (Array.isArray(node)) return node.map((v) => expand(v, spec, depth + 1, seen, maxDepth));

  const out = {};
  for (const [k, v] of Object.entries(node)) out[k] = expand(v, spec, depth + 1, seen, maxDepth);
  return out;
}

function resolveRef(ref, spec) {
  if (!ref.startsWith("#/")) return null;
  let cur = spec;
  for (const part of ref.slice(2).split("/")) {
    cur = cur?.[part.replace(/~1/g, "/").replace(/~0/g, "~")];
    if (cur === undefined) return null;
  }
  return cur;
}

const HTTP_METHODS = ["get", "post", "put", "patch", "delete", "head", "options"];

export function eachOperation(spec) {
  const out = [];
  for (const [path, item] of Object.entries(spec.paths || {})) {
    for (const method of HTTP_METHODS) {
      const op = item?.[method];
      if (op) out.push({ method: method.toUpperCase(), path, op, pathItem: item });
    }
  }
  return out;
}

export function findOperation(spec, method, path) {
  const m = method.toLowerCase();
  const item = spec.paths?.[path];
  if (item?.[m]) return { method: method.toUpperCase(), path, op: item[m], pathItem: item };

  // 경로를 정확히 못 찾으면 앞뒤 슬래시 차이 정도는 봐준다.
  const alt = path.endsWith("/") ? path.slice(0, -1) : `${path}/`;
  const altItem = spec.paths?.[alt];
  if (altItem?.[m]) return { method: method.toUpperCase(), path: alt, op: altItem[m], pathItem: altItem };

  return null;
}
