import { z } from "zod";
import { text, fail, namespaced } from "../../shared/mcp.js";
import { BASE_URL } from "../../shared/config.js";
import { findInstance, startInstance, stopInstance, setExtendUntil, explain } from "./ec2.js";

export const NAMESPACE = "dev_server";

// 자동 종료 Lambda 의 DEFAULT_HOURS 와 같아야 한다 (scripts/dev-autostop-lambda.mjs).
const DEFAULT_HOURS = 4;
const MAX_EXTEND_HOURS = 12;

const HOUR_MS = 3600_000;
const KST_OFFSET_MS = 9 * HOUR_MS;

const STATE_LABEL = {
  running: "켜짐",
  stopped: "꺼짐",
  pending: "켜지는 중",
  stopping: "꺼지는 중",
};

const clock = (t) => new Date(t + KST_OFFSET_MS).toISOString().slice(11, 16);

function remaining(ms) {
  const minutes = Math.round(ms / 60_000);
  return `${Math.floor(minutes / 60)}시간 ${minutes % 60}분 뒤`;
}

// 자동 종료는 매시 정각에 돈다. 켠 뒤 DEFAULT_HOURS 와 연장해 둔 시각 중 늦은 쪽이
// 지난 뒤 처음 오는 정각에 꺼진다.
function autoStopAt({ launchedAt, extendUntil }, now = Date.now()) {
  const keepUntil = Math.max(now, extendUntil || 0, launchedAt + DEFAULT_HOURS * HOUR_MS);
  return Math.ceil(keepUntil / HOUR_MS) * HOUR_MS;
}

const autoStopText = (instance, now = Date.now()) => {
  const at = autoStopAt(instance, now);
  return `${clock(at)} (${remaining(at - now)})`;
};

// 인스턴스가 running 이어도 앱은 1~2분 뒤에 뜬다. 로드밸런서가 앱에 닿지 못하면 5xx 가 온다.
async function appResponding() {
  try {
    const res = await fetch(BASE_URL, { signal: AbortSignal.timeout(5000) });
    return res.status < 500;
  } catch {
    return false;
  }
}

export function register(server, { local = true } = {}) {
  // 공유 서버에 EC2 권한을 두면 접속한 모두가 그 권한으로 서버를 끄고 켜게 된다.
  if (!local) return;

  const tool = namespaced(server, NAMESPACE);

  tool(
    "status",
    {
      title: "dev 서버 상태",
      description:
        "dev 서버가 켜져 있는지, 앱이 응답하는지, 언제 자동으로 꺼지는지 보여준다. " +
        "dev API 가 502 를 주거나 응답이 없으면 꺼져 있을 수 있으니 먼저 돌린다.",
      inputSchema: {},
    },
    async () => {
      let instance;
      try {
        instance = await findInstance();
      } catch (e) {
        return fail(explain(e));
      }

      const lines = [`dev 서버  ${STATE_LABEL[instance.state] || instance.state}`];
      if (instance.state === "running") {
        const up = await appResponding();
        lines.push(`  앱         ${up ? "응답함" : "아직 응답 없음 (켠 직후면 1~2분 걸립니다)"}`);
        lines.push(`  주소       ${BASE_URL}`);
        lines.push(`  퍼블릭 IP  ${instance.publicIp || "없음"} (켤 때마다 바뀝니다)`);
        lines.push(`  자동 종료  ${autoStopText(instance)}`);
        lines.push("  더 쓰려면 dev_server_extend 로 미룹니다.");
      }
      if (instance.state === "stopped") lines.push("  dev_server_start 로 켭니다.");
      return text(lines.join("\n"));
    }
  );

  tool(
    "start",
    {
      title: "dev 서버 켜기",
      description:
        "꺼져 있는 dev 서버를 켠다. 앱이 응답하기까지 1~2분 걸리므로 바로 호출하지 말고 dev_server_status 로 확인한다. " +
        `켠 뒤 ${DEFAULT_HOURS}시간이 지나면 다음 정각에 자동으로 꺼진다. 더 쓰려면 dev_server_extend 로 미룬다.`,
      inputSchema: {},
    },
    async () => {
      let instance;
      try {
        instance = await findInstance();
        if (instance.state === "running") return text("이미 켜져 있습니다.");
        if (instance.state === "pending") return text("이미 켜지는 중입니다.");
        if (instance.state === "stopping") {
          return fail("꺼지는 중이라 지금은 켤 수 없습니다. 1분쯤 뒤에 다시 시도하세요.");
        }
        await startInstance(instance.id);
      } catch (e) {
        return fail(explain(e));
      }
      return text(
        `켜는 중입니다. 앱이 응답하기까지 1~2분 걸립니다.\n` +
          `dev_server_status 로 확인하세요. ${autoStopText({ launchedAt: Date.now() })} 에 자동으로 꺼집니다.`
      );
    }
  );

  tool(
    "extend",
    {
      title: "dev 서버 자동 종료 미루기",
      description:
        "지금부터 정한 시간 동안 dev 서버가 자동으로 꺼지지 않게 한다. 자동 종료가 다가오는데 계속 써야 할 때 쓴다. " +
        "그 시간이 지나면 다음 정각에 꺼진다.",
      inputSchema: {
        hours: z
          .number()
          .int()
          .min(1)
          .max(MAX_EXTEND_HOURS)
          .optional()
          .describe(`미룰 시간. 생략하면 2, 최대 ${MAX_EXTEND_HOURS}`),
      },
    },
    async ({ hours = 2 }) => {
      const until = Date.now() + hours * HOUR_MS;
      let instance;
      try {
        instance = await findInstance();
        if (instance.state !== "running" && instance.state !== "pending") {
          return fail("dev 서버가 꺼져 있습니다. dev_server_start 로 먼저 켜세요.");
        }
        if (until > (instance.extendUntil || 0)) await setExtendUntil(instance.id, until);
      } catch (e) {
        return fail(explain(e));
      }
      const extendUntil = Math.max(until, instance.extendUntil || 0);
      return text(`${autoStopText({ ...instance, extendUntil })} 에 자동으로 꺼집니다.`);
    }
  );

  tool(
    "stop",
    {
      title: "dev 서버 끄기",
      description:
        "dev 서버를 끈다. 다른 사람이 쓰고 있을 수 있으니 호출하기 전에 반드시 사용자에게 확인받아라. " +
        "처리 중이던 요청과 배치는 끊긴다.",
      inputSchema: {},
    },
    async () => {
      try {
        const instance = await findInstance();
        if (instance.state === "stopped") return text("이미 꺼져 있습니다.");
        if (instance.state === "stopping") return text("이미 꺼지는 중입니다.");
        await stopInstance(instance.id);
      } catch (e) {
        return fail(explain(e));
      }
      return text("끄는 중입니다. 다시 쓰려면 dev_server_start 로 켭니다.");
    }
  );
}
