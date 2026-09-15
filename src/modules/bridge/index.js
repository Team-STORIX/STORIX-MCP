import { z } from "zod";
import { text, fail, namespaced } from "../../shared/mcp.js";
import { readChildren, credentialsPath } from "./config.js";
import { connect } from "./children.js";

export const NAMESPACE = "bridge";

// 자식이 주는 것은 JSON Schema 인데 registerTool 은 Zod 만 받는다. 인자는 그대로 흘려보내고,
// 대신 어떤 인자를 받는지는 설명에 적어 둔다. 안 그러면 모델이 무엇을 넣을지 알 수 없다.
const ANY_ARGS = z.object({}).passthrough();

const RESERVED = new Set(["swagger", "auth", "report", "metrics", "mobile", "flow", "bridge"]);

function argsText(schema) {
  const props = schema?.properties;
  if (!props || typeof props !== "object") return "";
  const required = new Set(Array.isArray(schema.required) ? schema.required : []);
  const parts = Object.entries(props).map(([name, v]) => {
    const type = Array.isArray(v?.type) ? v.type.join("|") : v?.type || "?";
    return `${name}: ${type}${required.has(name) ? " (필수)" : ""}`;
  });
  return parts.length ? `\n인자 — ${parts.join(", ")}` : "";
}

export async function register(server, { local = true } = {}) {
  // 자식은 그 사람 컴퓨터에서 뜨는 프로세스다. 여럿이 함께 쓰는 원격 모드에서는 뜻이 없다.
  if (!local) return;

  const configured = await readChildren();
  if (!configured.length) return;

  const connected = [];
  const skipped = [];

  for (const child of configured) {
    if (RESERVED.has(child.alias)) {
      skipped.push({ alias: child.alias, reason: "storix 가 이미 쓰는 이름" });
      continue;
    }
    try {
      connected.push(await connect(child));
    } catch (e) {
      skipped.push({ alias: child.alias, reason: e.message });
    }
  }

  for (const { alias, client, tools } of connected) {
    const tool = namespaced(server, alias);
    for (const t of tools) {
      tool(
        t.name,
        {
          title: t.title || `${alias} · ${t.name}`,
          description: `${t.description || t.name}${argsText(t.inputSchema)}`,
          inputSchema: ANY_ARGS,
        },
        async (args) => {
          try {
            return await client.callTool({ name: t.name, arguments: args ?? {} });
          } catch (e) {
            return fail(`${alias}_${t.name} 호출 실패: ${e.message}`);
          }
        }
      );
    }
  }

  // 자식을 닫지 않으면 그 프로세스가 살아 있어 우리가 끝나지 않는다.
  // 서버 transport 는 stdin 이 끝나도 close 를 부르지 않으니 stdin 을 직접 듣는다.
  if (connected.length) {
    let closing = false;
    const closeAll = () => {
      if (closing) return;
      closing = true;
      for (const { client } of connected) client.close().catch(() => {});
    };
    process.stdin.once("end", closeAll);
    process.stdin.once("close", closeAll);
  }

  const tool = namespaced(server, NAMESPACE);
  tool(
    "list",
    {
      title: "붙어 있는 로컬 MCP",
      description: "브리지로 물려 둔 서버와 그 툴을 보여준다. 툴이 안 보일 때 여기부터 본다.",
      inputSchema: {},
    },
    async () => {
      const lines = [`설정 파일  ${credentialsPath()}`, ""];

      if (!connected.length) lines.push("붙은 서버가 없습니다.");
      for (const { alias, tools } of connected) {
        lines.push(`${alias}  툴 ${tools.length}개`);
        for (const t of tools) lines.push(`  ${alias}_${t.name}`);
      }

      if (skipped.length) {
        lines.push("", "못 붙은 것");
        for (const s of skipped) lines.push(`  ${s.alias}  ${s.reason}`);
      }

      lines.push("", "툴 목록은 세션 시작 때 정해진다. 방금 고쳤다면 Claude Code 를 다시 켜야 잡힌다.");
      return text(lines.join("\n"));
    }
  );
}
