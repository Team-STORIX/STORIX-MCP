// dev 서버 자동 종료 Lambda. EventBridge 일정 DevServerAutoStop 이 매시 정각에 부른다.
// 켠 뒤 DEFAULT_HOURS 동안은 그대로 두고, dev_server_extend 가 적어 둔 extend-until 태그가
// 더 뒤면 그 시각까지 둔다. 둘 다 지났으면 끈다.
// Lambda 콘솔에 그대로 붙여 넣는다. 런타임에 SDK 가 들어 있어 따로 묶을 것이 없다.
import { EC2Client, DescribeInstancesCommand, StopInstancesCommand } from "@aws-sdk/client-ec2";

const INSTANCE_ID = process.env.INSTANCE_ID;
const DEFAULT_HOURS = Number(process.env.DEFAULT_HOURS || 4);
const HOUR_MS = 3600_000;

const ec2 = new EC2Client({});

export async function handler() {
  const res = await ec2.send(new DescribeInstancesCommand({ InstanceIds: [INSTANCE_ID] }));
  const instance = res.Reservations?.[0]?.Instances?.[0];
  const state = instance?.State?.Name;
  if (state !== "running") return { action: "skip", reason: `state=${state}` };

  const extendUntil = Date.parse(instance.Tags?.find((t) => t.Key === "extend-until")?.Value || "") || 0;
  const keepUntil = Math.max(extendUntil, new Date(instance.LaunchTime).getTime() + DEFAULT_HOURS * HOUR_MS);
  if (keepUntil > Date.now()) {
    return { action: "skip", reason: `keep until ${new Date(keepUntil).toISOString()}` };
  }

  await ec2.send(new StopInstancesCommand({ InstanceIds: [INSTANCE_ID] }));
  return { action: "stop" };
}
