import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StdioClientTransport } from "@modelcontextprotocol/sdk/client/stdio.js";

const TIMEOUT_MS = Number(process.env.STORIX_BRIDGE_TIMEOUT_MS || 10000);

// 자식 하나가 안 뜨거나 응답이 없어도 storix 는 떠야 한다. 그래서 전부 시간을 끊는다.
function withTimeout(promise, what) {
  let timer;
  const limit = new Promise((_, reject) => {
    timer = setTimeout(() => reject(new Error(`${what} 가 ${TIMEOUT_MS}ms 안에 끝나지 않았습니다`)), TIMEOUT_MS);
    timer.unref?.();
  });
  return Promise.race([promise, limit]).finally(() => clearTimeout(timer));
}

export async function connect({ alias, command, args, env }) {
  const client = new Client({ name: `storix-bridge-${alias}`, version: "1" });
  const transport = new StdioClientTransport({
    command,
    args,
    env: { ...process.env, ...env },
  });

  try {
    await withTimeout(client.connect(transport), `${alias} 연결`);
    const { tools } = await withTimeout(client.listTools(), `${alias} 툴 목록`);
    return { alias, client, tools: tools || [] };
  } catch (e) {
    await client.close().catch(() => {});
    throw e;
  }
}
