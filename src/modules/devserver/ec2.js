// EC2 는 각자 AWS 프로필로 직접 부른다. 누가 켜고 껐는지 CloudTrail 에 사람별로 남는다.
const REGION = process.env.AWS_REGION || process.env.AWS_DEFAULT_REGION || "ap-northeast-2";
const INSTANCE_NAME = process.env.STORIX_DEV_INSTANCE_NAME || "Dev Server";
const EXTEND_TAG = "extend-until";
const DEPLOY_TAG = "deploy-started-at";

let clientPromise = null;

async function client() {
  if (clientPromise) return clientPromise;
  clientPromise = (async () => {
    let mod;
    try {
      mod = await import("@aws-sdk/client-ec2");
    } catch {
      throw new Error("@aws-sdk/client-ec2 를 불러오지 못했습니다. npm install 을 다시 해보세요.");
    }
    return { mod, ec2: new mod.EC2Client({ region: REGION }) };
  })();
  return clientPromise;
}

const tagOf = (instance, key) => instance.Tags?.find((t) => t.Key === key)?.Value;

// 인스턴스 ID 는 다시 만들면 바뀌므로 Name 태그로 찾는다.
// 이름을 잘못 넣어 운영 서버를 잡는 일이 없게 Env 태그가 dev 인 것만 받는다.
export async function findInstance() {
  const { mod, ec2 } = await client();
  const res = await ec2.send(
    new mod.DescribeInstancesCommand({ Filters: [{ Name: "tag:Name", Values: [INSTANCE_NAME] }] })
  );
  const found = (res.Reservations || [])
    .flatMap((r) => r.Instances || [])
    .filter((i) => i.State?.Name !== "terminated");

  if (!found.length) throw new Error(`Name 태그가 "${INSTANCE_NAME}" 인 인스턴스가 없습니다.`);
  if (found.length > 1) throw new Error(`Name 태그가 "${INSTANCE_NAME}" 인 인스턴스가 ${found.length}개입니다.`);

  const instance = found[0];
  if (tagOf(instance, "Env") !== "dev") {
    throw new Error(`"${INSTANCE_NAME}" 의 Env 태그가 dev 가 아닙니다. dev 서버만 다룹니다.`);
  }
  return {
    id: instance.InstanceId,
    state: instance.State.Name,
    publicIp: instance.PublicIpAddress || null,
    launchedAt: new Date(instance.LaunchTime).getTime(),
    extendUntil: parseTime(tagOf(instance, EXTEND_TAG)),
    deployStartedAt: parseTime(tagOf(instance, DEPLOY_TAG)),
  };
}

function parseTime(value) {
  const t = Date.parse(value || "");
  return Number.isNaN(t) ? null : t;
}

// 자동 종료가 이 태그를 읽어 그 시각 전이면 끄지 않고 넘어간다.
export async function setExtendUntil(id, until) {
  const { mod, ec2 } = await client();
  await ec2.send(
    new mod.CreateTagsCommand({
      Resources: [id],
      Tags: [{ Key: EXTEND_TAG, Value: new Date(until).toISOString() }],
    })
  );
}

export async function startInstance(id) {
  const { mod, ec2 } = await client();
  await ec2.send(new mod.StartInstancesCommand({ InstanceIds: [id] }));
}

export async function stopInstance(id) {
  const { mod, ec2 } = await client();
  await ec2.send(new mod.StopInstancesCommand({ InstanceIds: [id] }));
}

export function explain(e) {
  if (e.name === "UnauthorizedOperation") {
    return "이 AWS 계정에는 dev 서버를 다룰 권한이 없습니다. IAM developers 그룹에 들어 있는지 확인하세요.";
  }
  if (e.name === "CredentialsProviderError") {
    return "AWS 자격증명을 찾지 못했습니다. aws configure 로 넣거나 AWS_PROFILE 을 지정하세요.";
  }
  return e.message;
}
