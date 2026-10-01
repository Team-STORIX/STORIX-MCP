// dev 서버 자동 종료 Lambda. EventBridge 일정 DevServerAutoStop 이 매시 정각에 부른다.
// 켠 뒤 DEFAULT_HOURS 동안은 그대로 두고, dev_server_extend 가 적어 둔 extend-until 태그가
// 더 뒤면 그 시각까지 둔다. 둘 다 지났으면 끈다.
// 배포가 켠 서버는 DEPLOY_MINUTES 만 둔다. 배포는 켤 때 deploy-started-at 태그를 적는데,
// 그 시각이 켜진 시각과 붙어 있으면 배포가 켠 것이다. 사람이 다시 켜면 옛 태그는 무시된다.
// Lambda 콘솔에 그대로 붙여 넣는다. 런타임에 SDK 가 들어 있어 따로 묶을 것이 없다.
import { EC2Client, DescribeInstancesCommand, StopInstancesCommand } from "@aws-sdk/client-ec2";

const INSTANCE_ID = process.env.INSTANCE_ID;
const DEFAULT_HOURS = Number(process.env.DEFAULT_HOURS || 4);
const DEPLOY_MINUTES = Number(process.env.DEPLOY_MINUTES || 30);
const HOUR_MS = 3600_000;

const ec2 = new EC2Client({});

export async function handler() {
  const res = await ec2.send(new DescribeInstancesCommand({ InstanceIds: [INSTANCE_ID] }));
  const instance = res.Reservations?.[0]?.Instances?.[0];
  const state = instance?.State?.Name;
  if (state !== "running") return { action: "skip", reason: `state=${state}` };

  const tagTime = (key) => Date.parse(instance.Tags?.find((t) => t.Key === key)?.Value || "") || 0;
  const launchedAt = new Date(instance.LaunchTime).getTime();
  const deployStartedAt = tagTime("deploy-started-at");
  const byDeploy = deployStartedAt > 0 && Math.abs(deployStartedAt - launchedAt) < 10 * 60_000;

  const keepMs = byDeploy ? DEPLOY_MINUTES * 60_000 : DEFAULT_HOURS * HOUR_MS;
  const keepUntil = Math.max(tagTime("extend-until"), launchedAt + keepMs);
  if (keepUntil > Date.now()) {
    return { action: "skip", reason: `keep until ${new Date(keepUntil).toISOString()}`, byDeploy };
  }

  await ec2.send(new StopInstancesCommand({ InstanceIds: [INSTANCE_ID] }));
  return { action: "stop", byDeploy };
}
