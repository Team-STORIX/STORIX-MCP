import { expand, eachOperation, findOperation } from "../swagger/spec.js";
import { commonErrors } from "../swagger/errors.js";

export const FRONTEND = "frontend";
export const BACKEND = "backend";
export const UNCLEAR = "unclear";

const OK_STATUS = /^2\d\d$/;

function pickSchema(content) {
  if (!content) return null;
  const key = Object.keys(content).find((t) => t.includes("json")) ?? Object.keys(content)[0];
  return key ? content[key]?.schema ?? null : null;
}

function typeOf(value) {
  if (value === null) return "null";
  if (Array.isArray(value)) return "array";
  if (Number.isInteger(value)) return "integer";
  return typeof value === "number" ? "number" : typeof value;
}

function typeMatches(expected, value) {
  if (!expected) return true;
  const actual = typeOf(value);
  if (actual === "null") return true; // nullable 여부는 스펙마다 제각각이라 여기서 따지지 않는다
  if (expected === "number") return actual === "number" || actual === "integer";
  if (expected === "integer") return actual === "integer";
  if (expected === "string") return actual === "string";
  if (expected === "boolean") return actual === "boolean";
  if (expected === "array") return actual === "array";
  if (expected === "object") return actual === "object";
  return true;
}

// 스펙 스키마와 실제 값을 견준다. 깊이는 얕게 본다 - 첫 단계에서 대부분 갈린다.
function checkAgainstSchema(schema, value, prefix, out, { side }) {
  if (!schema || value === null || typeof value !== "object" || Array.isArray(value)) return;

  const props = schema.properties || {};
  for (const name of schema.required || []) {
    if (!(name in value) || value[name] === undefined) {
      out.push({ side, text: `${prefix}${name} 이(가) 빠졌습니다 (스펙상 필수)` });
    }
  }

  for (const [name, actual] of Object.entries(value)) {
    const prop = props[name];
    if (!prop) {
      if (Object.keys(props).length) out.push({ side, text: `${prefix}${name} 은(는) 스펙에 없는 필드입니다`, soft: true });
      continue;
    }
    if (!typeMatches(prop.type, actual)) {
      out.push({ side, text: `${prefix}${name} 타입이 다릅니다: 스펙 ${prop.type}, 실제 ${typeOf(actual)}` });
    }
    if (prop.enum && actual != null && !prop.enum.includes(actual)) {
      out.push({ side, text: `${prefix}${name} 값 '${actual}' 은(는) 허용값이 아닙니다: ${prop.enum.join(", ")}` });
    }
    if (prop.properties && actual && typeof actual === "object") {
      checkAgainstSchema(prop, actual, `${prefix}${name}.`, out, { side });
    }
  }
}

function distance(a, b) {
  let prev = Array.from({ length: b.length + 1 }, (_, i) => i);
  for (let i = 1; i <= a.length; i++) {
    const row = [i];
    for (let j = 1; j <= b.length; j++) {
      row[j] = Math.min(prev[j] + 1, row[j - 1] + 1, prev[j - 1] + (a[i - 1] === b[j - 1] ? 0 : 1));
    }
    prev = row;
  }
  return prev[b.length];
}

// 오타를 짚어주려면 진짜 가까운 것만 골라야 한다. 엉뚱한 걸 권하면 오히려 헷갈린다.
function nearPaths(spec, path) {
  const norm = (p) => p.replace(/\{[^}]+\}/g, "{}").toLowerCase();
  const target = norm(path);
  const limit = Math.max(2, Math.floor(target.length * 0.2));

  return [...new Set(eachOperation(spec).map((o) => o.path))]
    .map((p) => ({ path: p, d: distance(target, norm(p)) }))
    .filter((x) => x.d <= limit)
    .sort((a, b) => a.d - b.d)
    .slice(0, 5)
    .map((x) => x.path);
}

function codesOf(spec, op) {
  const out = new Map();
  for (const [status, body] of Object.entries(op.responses || {})) {
    const content = expand(body, spec)?.content;
    for (const media of Object.values(content || {})) {
      for (const code of Object.keys(media?.examples || {})) out.set(code, status);
    }
  }
  return out;
}

function codeExistsAnywhere(spec, code) {
  for (const { method, path, op } of eachOperation(spec)) {
    const codes = codesOf(spec, op);
    if (codes.has(code)) return { method, path, status: codes.get(code) };
  }
  return null;
}

export function judge(spec, { method, path, request, query, status, response }) {
  const findings = [];
  const notes = [];

  const found = findOperation(spec, method, path);
  if (!found) {
    const near = nearPaths(spec, path);
    return {
      verdict: near.length ? FRONTEND : UNCLEAR,
      findings: [
        {
          side: near.length ? FRONTEND : UNCLEAR,
          text: near.length
            ? `${method.toUpperCase()} ${path} 는 스펙에 없습니다. 비슷한 경로가 있어 오타로 보입니다.`
            : `${method.toUpperCase()} ${path} 는 스펙에 없습니다. 아직 배포되지 않았거나 제거된 경로일 수 있습니다.`,
        },
      ],
      notes: near.length ? [`비슷한 경로: ${near.join(", ")}`] : ["swagger_history 로 최근에 제거됐는지 확인해 보세요."],
    };
  }

  const { op } = found;
  const opKey = `${found.method} ${found.path}`;

  // 요청 - 프론트가 보낸 것이 스펙에 맞는가
  if (request && typeof request === "object") {
    const schema = pickSchema(expand(op.requestBody, spec)?.content);
    if (schema) checkAgainstSchema(schema, request, "요청 ", findings, { side: FRONTEND });
    else notes.push("이 엔드포인트는 요청 바디를 받지 않습니다.");
  }

  if (query && typeof query === "object") {
    const params = (expand(op.parameters, spec) || []).filter((p) => p.in === "query");
    for (const p of params) {
      if (p.required && !(p.name in query)) findings.push({ side: FRONTEND, text: `쿼리 ${p.name} 이(가) 빠졌습니다 (필수)` });
    }
    for (const [name, value] of Object.entries(query)) {
      const p = params.find((x) => x.name === name);
      if (!p) {
        if (params.length) findings.push({ side: FRONTEND, text: `쿼리 ${name} 은(는) 스펙에 없습니다`, soft: true });
        continue;
      }
      if (p.schema?.enum && !p.schema.enum.includes(String(value))) {
        findings.push({ side: FRONTEND, text: `쿼리 ${name} 값 '${value}' 은(는) 허용값이 아닙니다: ${p.schema.enum.join(", ")}` });
      }
    }
  }

  // 응답 - 서버가 준 것이 스펙에 맞는가
  const statusText = status == null ? null : String(status);
  if (statusText) {
    // 인증 공통 에러는 개별 API 응답에 일부러 싣지 않는다. 그걸 모르면 멀쩡한 응답을 범인으로 몬다.
    const common = commonErrors(spec);
    const commonCode = response?.code ? common.find((c) => c.code === response.code) : null;
    const declared = Object.keys(op.responses || {});

    if (commonCode) {
      notes.push(`${commonCode.code} 는 공통 에러입니다 (${commonCode.section || "공통"}). 개별 API 응답 목록에는 실리지 않습니다.`);
    } else if (!declared.includes(statusText)) {
      findings.push({
        side: BACKEND,
        text: `${statusText} 는 이 API 스펙에 없는 상태값입니다. 문서에 있는 것: ${declared.join(", ")}`,
      });
    }

    const code = commonCode ? null : response?.code;
    if (code) {
      const codes = codesOf(spec, op);
      if (!codes.has(code)) {
        const elsewhere = codeExistsAnywhere(spec, code);
        findings.push({
          side: BACKEND,
          text: elsewhere
            ? `${code} 는 이 API에 문서화돼 있지 않습니다 (${elsewhere.method} ${elsewhere.path} 에는 있음).`
            : `${code} 는 스펙 어디에도 없는 코드입니다. 문서가 갱신되지 않았습니다.`,
        });
      } else if (codes.get(code) !== statusText) {
        findings.push({ side: BACKEND, text: `${code} 는 스펙상 ${codes.get(code)} 인데 ${statusText} 로 왔습니다.` });
      } else {
        notes.push(`${code} 는 이 API에 ${statusText} 로 문서화된 에러입니다. 어긋난 게 아니라 의도된 동작일 수 있습니다.`);
      }
    }

    if (OK_STATUS.test(statusText) && response && typeof response === "object") {
      const schema = pickSchema(expand(op.responses[statusText], spec)?.content);
      if (schema) checkAgainstSchema(schema, response, "응답 ", findings, { side: BACKEND });
    }

    if (statusText === "422" && response?.fieldErrors) {
      notes.push("422 + fieldErrors 는 요청 검증 실패입니다. fieldErrors 의 필드명이 어디가 틀렸는지 가리킵니다.");
    }
    if (statusText === "401" || statusText === "403") {
      notes.push("인증·권한 문제는 스펙만으로 못 가립니다. 토큰이 유효한지, 필요한 권한을 가진 계정인지 먼저 확인하세요.");
    }
  }

  const authIssue = statusText === "401" || statusText === "403";
  const hard = findings.filter((f) => !f.soft);
  const sides = new Set(hard.map((f) => f.side));
  const verdict = authIssue && !hard.length ? UNCLEAR : sides.size === 1 ? [...sides][0] : sides.size > 1 ? "both" : UNCLEAR;

  return { verdict, findings, notes, opKey, summary: op.summary };
}

const LABEL = {
  [FRONTEND]: "프론트엔드 쪽 문제로 보입니다",
  [BACKEND]: "백엔드 쪽 문제로 보입니다",
  both: "양쪽 모두에 어긋나는 점이 있습니다",
  [UNCLEAR]: "스펙만으로는 가릴 수 없습니다",
};

export function formatVerdict(result, input) {
  const lines = [`${input.method.toUpperCase()} ${input.path}${result.summary ? `  ${result.summary}` : ""}`, ""];
  lines.push(`판정: ${LABEL[result.verdict]}`, "");

  if (!result.findings.length) {
    lines.push("스펙과 어긋나는 점을 못 찾았습니다.");
  } else {
    for (const f of result.findings) {
      const who = f.side === FRONTEND ? "프론트" : f.side === BACKEND ? "백엔드" : "확인필요";
      lines.push(`  [${who}]${f.soft ? " (참고)" : ""} ${f.text}`);
    }
  }

  if (result.notes.length) {
    lines.push("", ...result.notes.map((n) => `  · ${n}`));
  }
  return lines.join("\n");
}
