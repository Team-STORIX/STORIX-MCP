import { readParams, paramPrefix } from "../../shared/params.js";

// .storix-mcp.json 에 계정이 없을 때 Parameter Store 에서 읽는다.
// tester 는 팀이 같이 쓰는 계정 하나라 고정 경로에, admin 은 각자 가입한 계정이라 IAM 사용자 이름 아래에 둔다.
// IAM 정책(scripts/auth-params-setup.sh)이 admin 경로를 ${aws:username} 으로 묶어 자기 계정만 읽고 쓰게 한다.
const REGION = process.env.AWS_REGION || process.env.AWS_DEFAULT_REGION || "ap-northeast-2";

export const TESTER_PARAMS = { pendingId: "auth/tester/pending-id" };
export const adminParams = (user) => ({ email: `auth/admin/${user}/email`, password: `auth/admin/${user}/password` });

/** arn:aws:iam::<계정>:user/<경로/>이름 → 이름. 역할(assumed-role) 등 IAM 사용자가 아니면 null */
export function userNameFromArn(arn) {
  const m = /^arn:aws:iam::\d+:user\/(?:[^/]+\/)*([^/]+)$/.exec(arn || "");
  return m ? m[1] : null;
}

async function iamUserName() {
  let mod;
  try {
    mod = await import("@aws-sdk/client-sts");
  } catch {
    throw new Error("@aws-sdk/client-sts 를 불러오지 못했습니다. npm install 을 다시 해보세요.");
  }
  const { Arn } = await new mod.STSClient({ region: REGION }).send(new mod.GetCallerIdentityCommand({}));
  const name = userNameFromArn(Arn);
  // ARN 에는 계정 ID 가 있어 그대로 보여주지 않는다
  if (!name) throw new Error("지금 AWS 프로필이 IAM 사용자가 아닙니다 (역할 등). admin 계정은 IAM 사용자 이름으로 찾습니다.");
  return name;
}

async function read(names) {
  const got = await readParams(Object.values(names));
  return Object.fromEntries(Object.entries(names).map(([k, n]) => [k, got[n]]));
}

/** role 의 계정을 Parameter Store 에서 읽는다. 실패하면 이유를 담아 throw */
export async function readAccount(role) {
  if (role === "tester") return read(TESTER_PARAMS);
  return read(adminParams(await iamUserName()));
}

export function paramPaths() {
  return {
    tester: `${paramPrefix}/${TESTER_PARAMS.pendingId}`,
    admin: `${paramPrefix}/auth/admin/<IAM 사용자 이름>/{email,password}`,
  };
}
