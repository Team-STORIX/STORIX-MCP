import { z } from "zod";
import { text, fail, namespaced } from "../../shared/mcp.js";
import { getSession } from "../../shared/session.js";
import { callApi, isWrite, WRITE_ENABLED } from "../../shared/api.js";
import { listFlows, readFlow, FLOWS_DIR } from "../../shared/flows.js";
import { fetchSpec, findOperation } from "../swagger/spec.js";
import { pick, compareWithSpec, fill } from "./judge.js";

export const NAMESPACE = "flow";

function splitApi(step) {
  const [method, path] = String(step.api).trim().split(/\s+/);
  return { method, path };
}

const pad = (s, n) => s + " ".repeat(Math.max(0, n - [...s].length));

export function register(server) {
  const tool = namespaced(server, NAMESPACE);

  tool(
    "list",
    {
      title: "시나리오 목록",
      description: "flows/ 에 있는 사용자 흐름 시나리오를 보여준다.",
      inputSchema: {},
    },
    async () => {
      const names = await listFlows();
      if (!names.length) return text(`시나리오가 없습니다 (${FLOWS_DIR}).`);

      const lines = [];
      for (const name of names) {
        try {
          const flow = await readFlow(name);
          const api = flow.steps.filter((s) => s.api).length;
          lines.push(`${name}  ${flow.title}  스텝 ${flow.steps.length}개 (API ${api}개)`);
        } catch (e) {
          lines.push(`${name}  읽기 실패: ${e.message}`);
        }
      }
      return text(lines.join("\n"));
    }
  );

  tool(
    "check",
    {
      title: "시나리오 점검",
      description: "호출하지 않고 각 스텝의 경로가 지금 스펙에 있는지만 확인한다. 배포로 경로가 사라졌는지 볼 때 쓴다.",
      inputSchema: { name: z.string().describe("시나리오 이름") },
    },
    async ({ name }) => {
      let flow;
      try {
        flow = await readFlow(name);
      } catch (e) {
        return fail(e.message);
      }

      let spec;
      try {
        spec = await fetchSpec();
      } catch (e) {
        return fail(`스펙을 못 읽었습니다: ${e.message}`);
      }

      const lines = [`${flow.title}`, ""];
      let gone = 0;
      for (const step of flow.steps) {
        if (!step.api) {
          lines.push(`  -  ${step.name || ""}  앱 전용 스텝`);
          continue;
        }
        const { method, path } = splitApi(step);
        const found = findOperation(spec, method, path);
        if (!found) gone++;
        lines.push(`  ${found ? "o" : "x"}  ${pad(step.name || "", 14)}${method} ${path}`);
      }
      lines.push("", gone ? `스펙에 없는 경로 ${gone}개. 시나리오를 고쳐야 합니다.` : "모든 경로가 스펙에 있습니다.");
      return text(lines.join("\n"));
    }
  );

  tool(
    "run",
    {
      title: "시나리오 실행",
      description:
        "시나리오를 순서대로 dev 서버에 호출하고 스펙과 대조해 판정한다. auth_login 으로 먼저 로그인해야 한다. " +
        "앞 스텝에서 뽑은 값을 다음 스텝에 넣으므로 한 스텝이 실패하면 거기서 멈춘다.",
      inputSchema: { name: z.string().describe("시나리오 이름") },
    },
    async ({ name }) => {
      if (!getSession()) {
        return fail("로그인이 안 돼 있습니다. auth_login 으로 먼저 들어가세요.");
      }

      let flow;
      try {
        flow = await readFlow(name);
      } catch (e) {
        return fail(e.message);
      }

      let spec = null;
      let specNote = "";
      try {
        spec = await fetchSpec();
      } catch (e) {
        specNote = `스펙을 못 읽어 대조는 건너뜁니다: ${e.message}`;
      }

      const vars = {};
      const lines = [];
      let passed = 0;
      let stopped = false;

      for (const step of flow.steps) {
        const label = pad(step.name || "", 14);

        if (stopped) {
          lines.push(`  -  ${label}앞 스텝이 실패해 건너뜀`);
          continue;
        }
        if (!step.api) {
          lines.push(`  -  ${label}앱 전용 스텝. mobile_open 으로 확인`);
          continue;
        }

        const { method, path } = splitApi(step);
        if (isWrite(method) && !WRITE_ENABLED) {
          lines.push(`  -  ${label}${method} 라 막혀 있어 건너뜀. SWAGGER_MCP_ALLOW_WRITE 로 켭니다`);
          continue;
        }

        const r = await callApi({
          method,
          path: fill(path, vars),
          query: fill(step.query, vars),
          body: fill(step.body, vars),
          headers: step.headers,
        });
        if (r.error) {
          lines.push(`  x  ${label}${r.error.split("\n")[0]}`);
          stopped = true;
          continue;
        }

        const problems = [];
        const want = step.status || null;
        if (want ? r.status !== want : !r.ok) problems.push(want ? `${want} 를 기대했는데 ${r.status}` : `HTTP ${r.status}`);

        for (const p of step.has || []) {
          if (pick(r.json, p) === undefined) problems.push(`${p} 가 응답에 없음`);
        }

        for (const [key, from] of Object.entries(step.capture || {})) {
          const value = pick(r.json, from);
          if (value === undefined) problems.push(`${from} 에서 ${key} 를 못 뽑음`);
          else vars[key] = value;
        }

        const warnings = [];
        if (spec) {
          const cmp = compareWithSpec(spec, method, path, r.status, r.json);
          if (cmp.unknown) warnings.push("스펙에 없는 경로");
          for (const k of cmp.missing || []) problems.push(`스펙의 필수 필드 ${k} 가 응답에 없음`);
          if (cmp.extra?.length) warnings.push(`스펙에 없는 필드 ${cmp.extra.join(", ")}`);
        }

        const ok = !problems.length;
        if (ok) passed++;
        else stopped = true;
        lines.push(`  ${ok ? "o" : "x"}  ${label}${method} ${path}  ${r.status} · ${r.elapsed}ms`);
        for (const p of problems) lines.push(`       ${p}`);
        for (const w of warnings) lines.push(`       참고: ${w}`);
      }

      const apiSteps = flow.steps.filter((s) => s.api).length;
      const head = `${flow.title}  API ${apiSteps}개 중 ${passed}개 통과`;
      const captured = Object.keys(vars).length ? `\n\n뽑아낸 값  ${Object.entries(vars).map(([k, v]) => `${k}=${v}`).join(" · ")}` : "";
      return text([head, specNote, "", ...lines].filter((l) => l !== "").join("\n") + captured);
    }
  );
}
