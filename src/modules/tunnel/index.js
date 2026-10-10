import { spawn, execFile } from "node:child_process";
import { mkdirSync, openSync, readFileSync, writeFileSync, rmSync, existsSync } from "node:fs";
import { homedir } from "node:os";
import net from "node:net";
import path from "node:path";
import { z } from "zod";
import { text, fail, namespaced } from "../../shared/mcp.js";
import { findInstanceId, rdsEndpoint, explain } from "./aws.js";

export const NAMESPACE = "tunnel";

const STATE_DIR = path.join(homedir(), ".storix-mcp", "tunnels");
const REGION = process.env.AWS_REGION || process.env.AWS_DEFAULT_REGION || "ap-northeast-2";

// SSM 포트 포워딩. 인스턴스 · RDS 는 이름으로 찾고, 로컬 포트는 BE 레포의 터널 스크립트와 같게 둔다.
const TUNNELS = {
  db: {
    title: "운영 DB (MySQL)",
    localPort: Number(process.env.STORIX_TUNNEL_DB_PORT || 13306),
    remotePort: 3306,
    // 운영 서버를 거쳐 RDS 로 간다. Env=prod 태그가 붙은 인스턴스만 쓴다
    instance: () => findInstanceId(process.env.STORIX_TUNNEL_DB_INSTANCE || "Production Server", "prod"),
    remoteHost: () => rdsEndpoint(process.env.STORIX_TUNNEL_DB_IDENTIFIER || "storix-deploy"),
  },
  grafana: {
    title: "모니터링 (Grafana)",
    localPort: Number(process.env.STORIX_TUNNEL_GRAFANA_PORT || 13000),
    remotePort: 3000,
    instance: () => findInstanceId(process.env.STORIX_TUNNEL_GRAFANA_INSTANCE || "Monitoring Server"),
    remoteHost: null,
    url: (port) => `http://localhost:${port}`,
  },
};

const NAMES = Object.keys(TUNNELS);
const pidFile = (name) => path.join(STATE_DIR, `${name}.pid`);
const logFile = (name) => path.join(STATE_DIR, `${name}.log`);

function portOpen(port) {
  return new Promise((resolve) => {
    const socket = net.connect({ host: "127.0.0.1", port });
    const done = (ok) => {
      socket.destroy();
      resolve(ok);
    };
    socket.setTimeout(1000, () => done(false));
    socket.once("connect", () => done(true));
    socket.once("error", () => done(false));
  });
}

function alive(pid) {
  try {
    process.kill(pid, 0);
    return true;
  } catch {
    return false;
  }
}

function readPid(name) {
  try {
    const pid = Number(readFileSync(pidFile(name), "utf8"));
    return pid && alive(pid) ? pid : null;
  } catch {
    return null;
  }
}

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

// aws ssm start-session 은 session-manager-plugin 을 자식으로 띄운다. 부모만 죽이면 플러그인이 남아
// 포트를 계속 잡고 있으므로, 새 프로세스 그룹으로 띄워 그룹째 끈다.
async function open(name) {
  const t = TUNNELS[name];
  const target = await t.instance();
  const params = { portNumber: [String(t.remotePort)], localPortNumber: [String(t.localPort)] };
  let document = "AWS-StartPortForwardingSession";
  if (t.remoteHost) {
    params.host = [await t.remoteHost()];
    document = "AWS-StartPortForwardingSessionToRemoteHost";
  }

  mkdirSync(STATE_DIR, { recursive: true });
  const log = openSync(logFile(name), "w");
  const child = spawn(
    "aws",
    ["ssm", "start-session", "--target", target, "--document-name", document,
      "--parameters", JSON.stringify(params), "--region", REGION],
    { detached: true, stdio: ["ignore", log, log] }
  );
  let exited = null;
  child.once("exit", (code) => (exited = code ?? -1));
  child.once("error", (e) => (exited = e.code === "ENOENT" ? "aws CLI 를 찾지 못했습니다." : e.message));
  child.unref();
  writeFileSync(pidFile(name), String(child.pid));

  for (let i = 0; i < 40; i++) {
    if (await portOpen(t.localPort)) return;
    if (exited !== null) break;
    await sleep(500);
  }
  rmSync(pidFile(name), { force: true });
  const out = existsSync(logFile(name)) ? readFileSync(logFile(name), "utf8").trim().split("\n").slice(-5).join("\n") : "";
  if (exited === null) {
    try {
      process.kill(-child.pid, "SIGTERM");
    } catch {}
  }
  throw new Error(
    `${typeof exited === "string" ? exited : "터널이 열리지 않았습니다."}` +
      (out ? `\n${out}` : "") +
      "\nsession-manager-plugin 이 설치돼 있는지, AWS 권한이 있는지 확인하세요."
  );
}

// 스크립트로 직접 연 터널은 pid 파일이 없다. 포트 번호로 플러그인을 찾아 끈다.
const pkillPlugin = (port) =>
  new Promise((resolve) => execFile("pkill", ["-f", `session-manager-plugin.*"${port}"`], () => resolve()));

async function close(name) {
  const t = TUNNELS[name];
  const pid = readPid(name);
  if (pid) {
    try {
      process.kill(-pid, "SIGTERM");
    } catch {
      try {
        process.kill(pid, "SIGTERM");
      } catch {}
    }
  }
  rmSync(pidFile(name), { force: true });
  await pkillPlugin(t.localPort);
  for (let i = 0; i < 10; i++) {
    if (!(await portOpen(t.localPort))) return true;
    await sleep(300);
  }
  return false;
}

async function describe(name) {
  const t = TUNNELS[name];
  const up = await portOpen(t.localPort);
  const pid = readPid(name);
  const where = t.url ? t.url(t.localPort) : `127.0.0.1:${t.localPort}`;
  if (!up) return `${name.padEnd(8)} 닫힘  (${t.title}, 열면 ${where})`;
  return `${name.padEnd(8)} 열림  ${where}  (${t.title}${pid ? "" : ", 이 툴 밖에서 연 터널"})`;
}

export function register(server, { local = true } = {}) {
  // 각자 AWS 프로필로 자기 컴퓨터에 포트를 연다. 공유 서버에서는 의미가 없다.
  if (!local) return;

  const tool = namespaced(server, NAMESPACE);
  const nameSchema = z.enum(NAMES).describe("db = 운영 DB(로컬 13306), grafana = 모니터링(로컬 13000)");

  tool(
    "status",
    {
      title: "터널 상태",
      description: "운영 DB · Grafana 터널이 열려 있는지, 어느 로컬 포트인지 보여준다.",
      inputSchema: {},
    },
    async () => text((await Promise.all(NAMES.map(describe))).join("\n"))
  );

  tool(
    "open",
    {
      title: "터널 열기",
      description:
        "SSM 포트 포워딩으로 터널을 연다. 백그라운드로 떠 있고, tunnel_close 로 닫을 때까지 유지된다. " +
        "db 는 운영 DB 로 가는 길이므로 열기 전에 반드시 사용자에게 확인받고, 쓰고 나면 닫아라. " +
        "aws CLI 와 session-manager-plugin 이 필요하다.",
      inputSchema: { name: nameSchema },
    },
    async ({ name }) => {
      const t = TUNNELS[name];
      if (await portOpen(t.localPort)) return text(`이미 열려 있습니다.\n${await describe(name)}`);
      try {
        await open(name);
      } catch (e) {
        return fail(explain(e));
      }
      return text(`열었습니다.\n${await describe(name)}\n다 쓰면 tunnel_close 로 닫으세요.`);
    }
  );

  tool(
    "close",
    {
      title: "터널 닫기",
      description: "열어 둔 터널을 닫는다. 이 툴 밖에서(스크립트로) 연 터널도 포트 번호로 찾아 닫는다.",
      inputSchema: { name: nameSchema },
    },
    async ({ name }) => {
      const t = TUNNELS[name];
      if (!(await portOpen(t.localPort)) && !readPid(name)) return text("이미 닫혀 있습니다.");
      const closed = await close(name);
      return closed
        ? text(`닫았습니다. (${name})`)
        : fail(`포트 ${t.localPort} 가 아직 열려 있습니다. 다른 프로그램이 쓰고 있는지 확인하세요 (lsof -i :${t.localPort}).`);
    }
  );
}
