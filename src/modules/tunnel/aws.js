// 터널 대상은 각자 AWS 프로필로 찾는다. 인스턴스 ID · RDS 주소는 다시 만들면 바뀌므로 이름으로 찾는다.
const REGION = process.env.AWS_REGION || process.env.AWS_DEFAULT_REGION || "ap-northeast-2";

const clients = {};

async function load(pkg, make) {
  if (clients[pkg]) return clients[pkg];
  clients[pkg] = (async () => {
    let mod;
    try {
      mod = await import(pkg);
    } catch {
      throw new Error(`${pkg} 를 불러오지 못했습니다. npm install 을 다시 해보세요.`);
    }
    return { mod, client: make(mod) };
  })();
  return clients[pkg];
}

const ec2 = () => load("@aws-sdk/client-ec2", (m) => new m.EC2Client({ region: REGION }));
const rds = () => load("@aws-sdk/client-rds", (m) => new m.RDSClient({ region: REGION }));

const tagOf = (instance, key) => instance.Tags?.find((t) => t.Key === key)?.Value;

// Name 태그로 실행 중인 인스턴스를 하나 찾는다. env 를 주면 Env 태그도 같아야 한다.
export async function findInstanceId(name, env) {
  const { mod, client } = await ec2();
  const res = await client.send(
    new mod.DescribeInstancesCommand({
      Filters: [
        { Name: "tag:Name", Values: [name] },
        { Name: "instance-state-name", Values: ["running"] },
      ],
    })
  );
  const found = (res.Reservations || []).flatMap((r) => r.Instances || []);
  if (!found.length) throw new Error(`Name 태그가 "${name}" 인 실행 중 인스턴스가 없습니다.`);
  if (found.length > 1) throw new Error(`Name 태그가 "${name}" 인 인스턴스가 ${found.length}개입니다.`);
  if (env && tagOf(found[0], "Env") !== env) {
    throw new Error(`"${name}" 의 Env 태그가 ${env} 가 아닙니다.`);
  }
  return found[0].InstanceId;
}

export async function rdsEndpoint(identifier) {
  const { mod, client } = await rds();
  const res = await client.send(new mod.DescribeDBInstancesCommand({ DBInstanceIdentifier: identifier }));
  const host = res.DBInstances?.[0]?.Endpoint?.Address;
  if (!host) throw new Error(`RDS "${identifier}" 의 주소를 찾지 못했습니다.`);
  return host;
}

export function explain(e) {
  if (e.name === "UnauthorizedOperation" || e.name === "AccessDenied" || e.name === "AccessDeniedException") {
    return "이 AWS 계정에는 터널 대상을 조회할 권한이 없습니다. IAM 권한을 확인하세요.";
  }
  if (e.name === "CredentialsProviderError") {
    return "AWS 자격증명을 찾지 못했습니다. aws configure 로 넣거나 AWS_PROFILE 을 지정하세요.";
  }
  if (e.name === "DBInstanceNotFoundFault") return `RDS 를 찾지 못했습니다: ${e.message}`;
  return e.message;
}
