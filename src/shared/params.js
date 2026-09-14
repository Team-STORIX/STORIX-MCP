// 자격증명을 설정 파일에 적는 대신 Parameter Store 에서 읽는다.
// SDK 는 이 경로를 탈 때만 불러온다. CLI·Lambda 는 환경변수를 쓰므로 영향이 없다.
const PREFIX = (process.env.STORIX_PARAM_PREFIX || "/storix/dev").replace(/\/$/, "");
const REGION = process.env.AWS_REGION || process.env.AWS_DEFAULT_REGION || "ap-northeast-2";

let clientPromise = null;

async function client() {
  if (clientPromise) return clientPromise;
  clientPromise = (async () => {
    let mod;
    try {
      mod = await import("@aws-sdk/client-ssm");
    } catch {
      throw new Error("@aws-sdk/client-ssm 을 불러오지 못했습니다. npm install 을 다시 해보세요.");
    }
    return { mod, ssm: new mod.SSMClient({ region: REGION }) };
  })();
  return clientPromise;
}

// 여러 값을 한 번에 가져온다. 이름은 PREFIX 아래 상대 경로로 준다.
export async function readParams(names) {
  const { mod, ssm } = await client();
  const full = names.map((n) => `${PREFIX}/${n}`);

  const res = await ssm.send(new mod.GetParametersCommand({ Names: full, WithDecryption: true }));

  if (res.InvalidParameters?.length) {
    throw new Error(`Parameter Store 에 없는 값: ${res.InvalidParameters.join(", ")}`);
  }
  return Object.fromEntries((res.Parameters || []).map((p) => [p.Name.slice(PREFIX.length + 1), p.Value]));
}

export const paramPrefix = PREFIX;
