import { z } from "zod";
import { text, fail, namespaced } from "../../shared/mcp.js";
import { setSession, getSession, clearSession, expiryOf, remainingText } from "../../shared/session.js";
import { BASE_URL } from "../../shared/config.js";
import { readCredentials, writeCredentials, ensureIgnored, credentialsPath, FILE_NAME } from "./credentials.js";
import { redact } from "../../shared/redact.js";

export const NAMESPACE = "auth";

const ROLES = ["admin", "tester"];

async function post(path, body) {
  const res = await fetch(`${BASE_URL}${path}`, {
    method: "POST",
    headers: { "Content-Type": "application/json", Accept: "application/json" },
    body: JSON.stringify(body),
  });
  const raw = await res.text();
  let json = null;
  try {
    json = JSON.parse(raw);
  } catch {
    // JSON이 아니면 원문을 그대로 들고 간다
  }
  return { ok: res.ok, status: res.status, json, raw };
}

function apiError(prefix, { status, json, raw }) {
  const code = json?.code ? ` ${json.code}` : "";
  const message = json?.message || redact(raw).slice(0, 200);
  return fail(`${prefix}: HTTP ${status}${code} ${message}`);
}

async function issueTokens(role, creds) {
  if (role === "admin") {
    const { email, password } = creds.admin || {};
    if (!email || !password) return { missing: "admin 계정(email, password)" };
    return { result: await post("/api/v1/auth/admin/login", { email, password }) };
  }
  const { pendingId } = creds.tester || {};
  if (!pendingId) return { missing: "tester 계정(pendingId)" };
  return { result: await post("/api/v1/auth/tester/login", { pendingId }) };
}

export function register(server, { local = true } = {}) {
  const tool = namespaced(server, NAMESPACE);

  // 공유 서버에서 한 사람 자격증명으로 모두가 호출하게 되면 안 된다.
  if (!local) {
    tool(
      "status",
      {
        title: "로그인 상태",
        description: "이 서버에서는 로그인 기능이 꺼져 있다.",
        inputSchema: {},
      },
      async () =>
        text(
          "이 서버는 여러 사람이 함께 쓰는 원격 모드라 로그인 기능이 꺼져 있습니다.\n" +
            "한 사람의 자격증명으로 모두가 API를 호출하게 되기 때문입니다.\n" +
            "직접 호출이 필요하면 swagger_call_api의 token 인자에 본인 JWT를 넘기세요."
        )
    );
    return;
  }

  tool(
    "setup",
    {
      title: "계정 등록",
      description:
        `로그인에 쓸 계정을 ${FILE_NAME} 파일에 저장하고 .gitignore에 등록한다. ` +
        "admin은 email/password, tester는 pendingId를 넣는다. 한 번 해두면 auth_login만 부르면 된다. " +
        "비밀번호를 .env·local.env·application.yml 같은 파일에서 찾아 읽어 넣지 마라. " +
        "그런 파일에는 다른 시크릿도 함께 들어 있다. 사용자에게 직접 받아라.",
      inputSchema: {
        as: z.enum(ROLES).describe("admin 또는 tester"),
        email: z.string().optional().describe("admin일 때"),
        password: z.string().optional().describe("admin일 때"),
        pendingId: z.string().optional().describe("tester일 때. 슬랙 승인을 받은 pendingId"),
      },
    },
    async ({ as, email, password, pendingId }) => {
      const creds = await readCredentials();

      if (as === "admin") {
        if (!email || !password) return fail("admin은 email과 password가 둘 다 필요합니다.");
        creds.admin = { email, password };
      } else {
        if (!pendingId) return fail("tester는 pendingId가 필요합니다. 없으면 auth_signup_tester부터 부르세요.");
        creds.tester = { pendingId };
      }

      const file = await writeCredentials(creds);
      const ignore = await ensureIgnored();
      return text(
        `${as} 계정을 저장했습니다.\n` +
          `  파일      ${file}\n` +
          `  .gitignore ${ignore.added ? `${FILE_NAME} 추가함` : "이미 등록돼 있음"} (${ignore.file})\n\n` +
          `auth_login {as: "${as}"} 로 로그인하세요.`
      );
    }
  );

  tool(
    "login",
    {
      title: "로그인",
      description:
        "저장된 계정으로 토큰을 발급받아 들고 있는다. 이후 swagger_call_api가 이 토큰을 자동으로 쓴다. " +
        "토큰은 이 프로세스 메모리에만 있고 파일로 남기지 않는다.",
      inputSchema: {
        as: z.enum(ROLES).optional().describe("생략하면 저장된 계정 중 admin 우선"),
      },
    },
    async ({ as }) => {
      const creds = await readCredentials();
      const role = as || (creds.admin ? "admin" : creds.tester ? "tester" : null);
      if (!role) {
        return fail(
          `등록된 계정이 없습니다 (${credentialsPath()}).\n` +
            `auth_setup으로 admin 또는 tester 계정을 먼저 넣으세요.`
        );
      }

      const { missing, result } = await issueTokens(role, creds);
      if (missing) return fail(`${missing}가 저장돼 있지 않습니다. auth_setup으로 넣으세요.`);
      if (!result.ok) {
        const denied = role === "tester" && result.status === 403;
        const failure = apiError(`${role} 로그인 실패`, result);
        if (denied) {
          failure.content[0].text += "\n\n아직 슬랙 승인이 안 된 pendingId입니다. 승인 후 다시 시도하세요.";
        }
        return failure;
      }

      const tokens = result.json?.result || {};
      if (!tokens.accessToken) return fail(`토큰이 응답에 없습니다: ${redact(result.raw).slice(0, 200)}`);

      const expiresAt = expiryOf(tokens.accessToken);
      setSession({ role, ...tokens, expiresAt });
      return text(`${role}로 로그인했습니다. accessToken ${remainingText(expiresAt)}.\n이제 swagger_call_api가 이 토큰을 자동으로 씁니다.`);
    }
  );

  tool(
    "signup_tester",
    {
      title: "테스터 가입 요청",
      description:
        "테스터 가입을 요청해 pendingId를 받고 파일에 저장한다. 실제 승인은 슬랙에서 사람이 눌러야 하고, " +
        "요청은 10분 안에 승인돼야 한다. 승인 뒤 auth_login으로 들어간다.",
      inputSchema: {
        nickName: z.string().describe("닉네임"),
        favoriteGenreList: z.array(z.string()).describe("선호 장르 enum 목록. 값은 swagger_get_schema로 확인"),
        favoriteWorksIdList: z.array(z.number()).optional().describe("온보딩 관심 작품 id 목록"),
      },
    },
    async ({ nickName, favoriteGenreList, favoriteWorksIdList }) => {
      const result = await post("/api/v1/auth/tester/signup", {
        nickName,
        favoriteGenreList,
        ...(favoriteWorksIdList?.length ? { favoriteWorksIdList } : {}),
      });
      if (!result.ok) return apiError("테스터 가입 요청 실패", result);

      const pendingId = result.json?.result?.pendingId;
      if (!pendingId) return fail(`pendingId가 응답에 없습니다: ${redact(result.raw).slice(0, 200)}`);

      const creds = await readCredentials();
      creds.tester = { pendingId };
      await writeCredentials(creds);
      await ensureIgnored();

      return text(
        `가입 요청됨. pendingId를 ${FILE_NAME}에 저장했습니다.\n\n` +
          `  pendingId  ${pendingId}\n\n` +
          `슬랙에서 이 요청을 승인해야 합니다. 승인 기한은 10분입니다.\n` +
          `승인 뒤 auth_login {as: "tester"} 로 들어가세요. 이 pendingId는 승인 후에도 계속 로그인 키로 씁니다.`
      );
    }
  );

  tool(
    "status",
    {
      title: "로그인 상태",
      description: "지금 어떤 계정으로 로그인돼 있는지, 토큰이 얼마나 남았는지 본다.",
      inputSchema: {},
    },
    async () => {
      const creds = await readCredentials();
      const saved = ROLES.filter((r) => creds[r]);
      const session = getSession();

      const lines = [
        `자격증명 파일  ${credentialsPath()}`,
        `저장된 계정    ${saved.length ? saved.join(", ") : "없음"}`,
        session
          ? `로그인         ${session.role} · accessToken ${remainingText(session.expiresAt)}`
          : "로그인         안 됨",
      ];
      return text(lines.join("\n"));
    }
  );

  tool(
    "logout",
    {
      title: "로그아웃",
      description: "들고 있던 토큰을 버린다. 저장된 계정 자체는 남는다.",
      inputSchema: {},
    },
    async () => {
      clearSession();
      return text("토큰을 버렸습니다. 계정은 그대로 남아 있어 auth_login으로 다시 들어갈 수 있습니다.");
    }
  );
}
