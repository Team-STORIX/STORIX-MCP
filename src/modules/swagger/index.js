import { z } from "zod";
import { text, fail, namespaced } from "../../shared/mcp.js";
import { getSession, refreshSession, isExpired } from "../../shared/session.js";
import { config, fetchSpec, expand, eachOperation, findOperation } from "./spec.js";
import { diffSpecs, formatDiff } from "./diff.js";
import { saveSnapshot, loadSnapshot, listSnapshots, listEntries } from "./snapshots.js";
import { collectHistory, formatHistory } from "./history.js";
import { GUIDE } from "./guide.js";
import { collectErrors, commonErrors, renderForOperation, renderByCode, renderList } from "./errors.js";

export const NAMESPACE = "swagger";

const DEV_TOKEN = process.env.STORIX_DEV_TOKEN || "";
const WRITE_METHODS = new Set(["POST", "PUT", "PATCH", "DELETE"]);

// 쓰기 허용은 사람이 MCP 설정에서 켜야 한다. AI가 인자로 열 수 있으면 관문이 아니다.
const WRITE_ENABLED = process.env.SWAGGER_MCP_ALLOW_WRITE === "true";

function summarize({ method, path, op }) {
  const tags = op.tags?.length ? ` [${op.tags.join(", ")}]` : "";
  const desc = op.summary || op.operationId || "";
  return `${method} ${path}${tags}${desc ? ` - ${desc}` : ""}`;
}

export function register(server) {
  const tool = namespaced(server, NAMESPACE);

  // 클라이언트에 슬래시 커맨드로 뜬다. 파일을 깔 필요 없이 연결만으로 사용법이 따라간다.
  server.registerPrompt(
    NAMESPACE,
    {
      title: "STORIX Swagger 사용법",
      description: "dev API 스펙을 조회·호출·비교하는 법. 어떤 툴을 언제 쓰는지와 주의점.",
    },
    () => ({ messages: [{ role: "user", content: { type: "text", text: GUIDE } }] })
  );

  tool(
    "list_endpoints",
    {
      title: "엔드포인트 목록",
      description:
        "dev Swagger 스펙의 API 엔드포인트를 나열한다. keyword/tag/method로 좁힐 수 있다. " +
        "특정 API를 찾을 때 먼저 이걸 쓰고, 상세 스키마는 swagger_get_endpoint로 본다.",
      inputSchema: {
        keyword: z.string().optional().describe("경로·요약·operationId에 대한 부분 일치 검색어"),
        tag: z.string().optional().describe("Swagger 태그(컨트롤러 단위)로 필터"),
        method: z.string().optional().describe("HTTP 메서드로 필터 (GET, POST 등)"),
      },
    },
    async ({ keyword, tag, method }) => {
      const spec = await fetchSpec();
      let ops = eachOperation(spec);

      if (method) ops = ops.filter((o) => o.method === method.toUpperCase());
      if (tag) ops = ops.filter((o) => o.op.tags?.some((t) => t.toLowerCase().includes(tag.toLowerCase())));
      if (keyword) {
        const k = keyword.toLowerCase();
        ops = ops.filter((o) =>
          [o.path, o.op.summary, o.op.operationId, o.op.description]
            .filter(Boolean)
            .some((s) => String(s).toLowerCase().includes(k))
        );
      }

      if (!ops.length) return text("조건에 맞는 엔드포인트가 없습니다.");

      ops.sort((a, b) => a.path.localeCompare(b.path) || a.method.localeCompare(b.method));
      return text(`${ops.length}개:\n\n${ops.map((o) => `- ${summarize(o)}`).join("\n")}`);
    }
  );

  tool(
    "get_endpoint",
    {
      title: "엔드포인트 상세",
      description:
        "특정 엔드포인트의 파라미터·요청 바디·응답 스키마를 $ref까지 펼쳐서 보여준다. " +
        "path는 swagger_list_endpoints가 알려준 형태 그대로 넣는다 (예: /api/v1/users/{userId}).",
      inputSchema: {
        method: z.string().describe("HTTP 메서드"),
        path: z.string().describe("경로 템플릿"),
      },
    },
    async ({ method, path }) => {
      const spec = await fetchSpec();
      const found = findOperation(spec, method, path);
      if (!found)
        return fail(`${method.toUpperCase()} ${path} 를 스펙에서 못 찾았습니다. swagger_list_endpoints로 정확한 경로를 확인하세요.`);

      const { op } = found;
      const detail = {
        operation: `${found.method} ${found.path}`,
        summary: op.summary,
        description: op.description,
        tags: op.tags,
        deprecated: op.deprecated || undefined,
        security: op.security ?? spec.security,
        parameters: expand(op.parameters, spec),
        requestBody: expand(op.requestBody, spec),
        responses: expand(op.responses, spec),
      };
      return text(JSON.stringify(detail, null, 2));
    }
  );

  tool(
    "get_schema",
    {
      title: "스키마 조회",
      description: "components.schemas의 특정 DTO 스키마를 펼쳐서 보여준다. 이름 없이 부르면 전체 목록을 준다.",
      inputSchema: {
        name: z.string().optional().describe("스키마 이름. 생략하면 목록만 반환"),
      },
    },
    async ({ name }) => {
      const spec = await fetchSpec();
      const schemas = spec.components?.schemas || {};

      if (!name) {
        const names = Object.keys(schemas).sort();
        return text(`스키마 ${names.length}개:\n\n${names.map((n) => `- ${n}`).join("\n")}`);
      }

      const exact = schemas[name];
      if (exact) return text(JSON.stringify(expand(exact, spec), null, 2));

      const near = Object.keys(schemas).filter((n) => n.toLowerCase().includes(name.toLowerCase()));
      if (!near.length) return fail(`'${name}' 스키마가 없습니다.`);
      if (near.length === 1) return text(JSON.stringify(expand(schemas[near[0]], spec), null, 2));
      return text(`'${name}'와 비슷한 스키마:\n\n${near.map((n) => `- ${n}`).join("\n")}`);
    }
  );

  tool(
    "errors",
    {
      title: "에러 코드",
      description:
        "이 API가 어떤 에러 코드를 내는지만 뽑아 보여준다. get_endpoint는 스키마까지 통째로 주지만 " +
        "에러 분기만 짤 때는 이게 훨씬 짧다. code를 주면 그 코드가 어디서 나가는지 거꾸로 찾는다. " +
        "인자 없이 부르면 전체 코드 목록이라 프론트 코드의 에러 분기와 대조할 때 쓴다.",
      inputSchema: {
        path: z.string().optional().describe("엔드포인트 경로. method와 같이 준다"),
        method: z.string().optional().describe("HTTP 메서드"),
        tag: z.string().optional().describe("기능 단위로 좁힐 때. 부분 일치"),
        code: z.string().optional().describe("이 코드가 어느 API에서 나가는지 역방향 조회. 부분 일치"),
      },
    },
    async ({ path, method, tag, code }) => {
      const spec = await fetchSpec();
      const entries = [...collectErrors(spec).values()];
      const common = commonErrors(spec);

      if (code) return text(renderByCode(entries, code));

      if (path) {
        if (!method) return fail("path를 줄 때는 method도 같이 주세요.");
        const found = findOperation(spec, method, path);
        if (!found) return fail(`${method.toUpperCase()} ${path} 를 스펙에서 못 찾았습니다.`);
        return text(renderForOperation(spec, entries, `${found.method} ${found.path}`, common));
      }

      return text(renderList(entries, { tag, common }));
    }
  );

  tool(
    "call_api",
    {
      title: "API 호출",
      description:
        "dev 서버에 실제로 요청을 보내고 응답을 반환한다. 인증은 STORIX_DEV_TOKEN 환경변수 또는 token 인자를 Bearer로 붙인다. " +
        "기본은 읽기 전용이라 GET/HEAD/OPTIONS만 나간다. 쓰기 메서드는 서버 설정에서 사람이 켜야 하고, " +
        "임의로 켤 수 없으니 막히면 사용자에게 알리고 멈춘다.",
      inputSchema: {
        method: z.string().describe("HTTP 메서드"),
        path: z.string().describe("경로. {userId} 같은 템플릿은 pathParams로 채운다"),
        pathParams: z.record(z.union([z.string(), z.number()])).optional().describe("경로 변수 값"),
        query: z.record(z.union([z.string(), z.number(), z.boolean()])).optional().describe("쿼리 파라미터"),
        body: z.unknown().optional().describe("JSON 요청 바디"),
        headers: z.record(z.string()).optional().describe("추가 헤더"),
        token: z.string().optional().describe("이 호출에만 쓸 JWT. 없으면 STORIX_DEV_TOKEN 사용"),
      },
    },
    async ({ method, path, pathParams, query, body, headers, token }) => {
      const m = method.toUpperCase();
      if (WRITE_METHODS.has(m) && !WRITE_ENABLED) {
        return fail(
          `${m}은 dev 데이터를 변경하므로 이 서버에서 막혀 있습니다.\n\n` +
            `허용하려면 사용자가 MCP 설정에 SWAGGER_MCP_ALLOW_WRITE=true 를 넣고 재시작해야 합니다. ` +
            `이 도구의 인자로는 켤 수 없습니다.`
        );
      }

      let filled = path;
      for (const [k, v] of Object.entries(pathParams || {})) {
        filled = filled.replaceAll(`{${k}}`, encodeURIComponent(String(v)));
      }
      const missing = filled.match(/\{[^}]+\}/g);
      if (missing) return fail(`경로 변수 ${missing.join(", ")} 가 안 채워졌습니다. pathParams로 넘기세요.`);

      const url = new URL(filled.startsWith("http") ? filled : `${config.BASE_URL}${filled}`);
      for (const [k, v] of Object.entries(query || {})) url.searchParams.set(k, String(v));

      // 인자로 준 토큰이 우선. 없으면 auth_login으로 받아둔 세션, 그것도 없으면 환경변수.
      const useSession = !token && Boolean(getSession());
      if (useSession && isExpired()) await refreshSession(config.BASE_URL);

      const bearerOf = () => token || getSession()?.accessToken || DEV_TOKEN;
      const reqHeaders = { Accept: "application/json", ...(headers || {}) };
      if (body !== undefined) reqHeaders["Content-Type"] = "application/json";

      const send = async () => {
        const bearer = bearerOf();
        const h = { ...reqHeaders };
        if (bearer) h.Authorization = `Bearer ${bearer}`;
        return fetch(url, {
          method: m,
          headers: h,
          body: body === undefined ? undefined : JSON.stringify(body),
        });
      };

      const started = Date.now();
      let res;
      let refreshed = false;
      try {
        res = await send();
        // 만료를 미리 못 잡는 경우가 있다. 401이면 한 번만 다시 받아서 재시도한다.
        if (res.status === 401 && useSession && (await refreshSession(config.BASE_URL))) {
          refreshed = true;
          res = await send();
        }
      } catch (e) {
        return fail(`요청 실패: ${e.message}`);
      }
      const elapsed = Date.now() - started;

      const raw = await res.text();
      let pretty = raw;
      try {
        pretty = JSON.stringify(JSON.parse(raw), null, 2);
      } catch {
        // JSON이 아니면 원문 그대로
      }

      const authNote = !bearerOf()
        ? res.status === 401
          ? "\n\n(토큰이 없습니다. auth_login으로 로그인하거나 token 인자로 넘기세요.)"
          : ""
        : res.status === 401 && useSession
          ? "\n\n(토큰을 다시 받아 재시도했는데도 401입니다. auth_login으로 다시 로그인하세요.)"
          : refreshed
            ? "\n\n(만료된 토큰을 재발급해 다시 보냈습니다.)"
            : "";
      return text(
        `${m} ${url.pathname}${url.search}\nHTTP ${res.status} ${res.statusText} · ${elapsed}ms\n\n${pretty}${authNote}`
      );
    }
  );

  tool(
    "snapshot_spec",
    {
      title: "스펙 스냅샷 저장",
      description:
        "현재 dev 스펙을 라벨을 붙여 로컬에 저장한다. 나중에 swagger_diff_spec으로 이 시점 대비 변경을 볼 수 있다. " +
        "라벨 없이 부르면 저장된 스냅샷 목록을 반환한다.",
      inputSchema: {
        label: z.string().optional().describe("스냅샷 이름 (예: v2.4.2, before-refactor)"),
        pr: z.union([z.string(), z.number()]).optional().describe("이 배포를 만든 PR 번호"),
        commit: z.string().optional().describe("배포된 커밋 SHA"),
        title: z.string().optional().describe("무슨 작업이었는지 한 줄"),
      },
    },
    async ({ label, pr, commit, title }) => {
      if (!label) {
        const entries = await listEntries();
        if (!entries.length) return text("저장된 스냅샷이 없습니다.");
        const rows = entries
          .slice()
          .reverse()
          .map((e) => `- ${e.label}  (${e.savedAt.slice(0, 16).replace("T", " ")})${e.pr ? ` PR #${e.pr}` : ""}${e.title ? ` ${e.title}` : ""}`);
        return text(`저장된 스냅샷 ${entries.length}개:\n\n${rows.join("\n")}`);
      }
      const spec = await fetchSpec({ force: true });
      const file = await saveSnapshot(label, spec, { pr, commit, title });
      const count = eachOperation(spec).length;
      return text(`스냅샷 '${label}' 저장 완료 (엔드포인트 ${count}개)\n${file}`);
    }
  );

  tool(
    "history",
    {
      title: "변경 이력",
      description:
        "배포 시점마다 찍힌 스냅샷을 이웃끼리 비교해 '언제 무엇이 바뀌었는지'를 시간순으로 보여준다. " +
        "인자 없이 부르면 최근 배포 1건. 특정 기능만 보려면 tag, 특정 API만 보려면 path를 넣는다. " +
        "'뭐 바뀌었어', '이 API 최근에 바뀐 적 있어' 같은 질문에는 diff_spec 말고 이걸 쓴다.",
      inputSchema: {
        since: z.string().optional().describe("이 시점 이후만. '3d', '2w', '12h' 또는 '2026-08-20'"),
        tag: z.string().optional().describe("Swagger 태그(기능 단위)로 필터. 부분 일치 (예: 토픽룸)"),
        path: z.string().optional().describe("엔드포인트 하나로 좁힐 때의 경로 템플릿"),
        limit: z.number().optional().describe("since 없이 볼 때 되짚을 배포 수. 기본 1"),
      },
    },
    async ({ since, tag, path, limit }) => {
      const result = await collectHistory({ since, tag, path, limit }, fetchSpec);
      return text(formatHistory(result, { since, tag, path }));
    }
  );

  tool(
    "diff_spec",
    {
      title: "스펙 변경 비교",
      description:
        "저장된 스냅샷과 현재 dev 스펙을 비교해 추가/제거/변경된 엔드포인트와 호환성이 깨지는 변경을 보고한다. " +
        "두 스냅샷끼리 비교하려면 to에도 라벨을 넣는다.",
      inputSchema: {
        from: z.string().describe("기준이 되는 스냅샷 라벨"),
        to: z.string().optional().describe("비교 대상 스냅샷 라벨. 생략하면 현재 dev 스펙"),
      },
    },
    async ({ from, to }) => {
      const before = await loadSnapshot(from);
      if (!before) {
        const list = await listSnapshots();
        return fail(`스냅샷 '${from}'이 없습니다. 있는 것: ${list.join(", ") || "(없음)"}`);
      }

      let after, afterLabel;
      if (to) {
        after = await loadSnapshot(to);
        if (!after) return fail(`스냅샷 '${to}'이 없습니다.`);
        afterLabel = to;
      } else {
        after = await fetchSpec({ force: true });
        afterLabel = "현재 dev";
      }

      return text(formatDiff(diffSpecs(before, after), from, afterLabel));
    }
  );

  tool(
    "refresh_spec",
    {
      title: "스펙 캐시 갱신",
      description: "스펙 캐시를 버리고 dev 서버에서 다시 받아온다. 배포 직후 최신 스펙이 안 보일 때 쓴다.",
      inputSchema: {},
    },
    async () => {
      const spec = await fetchSpec({ force: true });
      return text(
        `갱신 완료: ${spec.info?.title || "(제목 없음)"} v${spec.info?.version || "?"} · ` +
          `엔드포인트 ${eachOperation(spec).length}개 · 스키마 ${Object.keys(spec.components?.schemas || {}).length}개`
      );
    }
  );
}
