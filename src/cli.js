#!/usr/bin/env node
// CD 에서 부르는 진입점. MCP 서버는 stdio 대화용이라 배포 파이프라인에서 쓰기 어색하다.
// 판정 로직이 MCP 와 CD 에서 갈라지지 않게 같은 모듈을 그대로 쓴다.
import { fetchSpec } from "./modules/swagger/spec.js";
import { saveSnapshot, loadSnapshot, listEntries } from "./modules/swagger/snapshots.js";
import { summarize, formatChangelog } from "./modules/swagger/diff.js";
import { send, configured as slackConfigured } from "./modules/report/slack.js";

const USAGE = `사용법
  node src/cli.js snapshot  [--label <라벨>] [--commit <sha>] [--pr <번호>] [--title <한 줄>]
  node src/cli.js changelog [--label <라벨>] [--commit <sha>] [--pr <번호>] [--title <한 줄>]
                            [--env <이름>] [--fail-on-breaking] [--no-slack]

  snapshot   지금 스펙을 떠서 저장만 한다
  changelog  스펙을 뜨고 직전 스냅샷과 비교해 변경 내역을 출력한다.
             STORIX_SLACK_WEBHOOK_URL 이 있으면 슬랙으로도 보낸다`;

function parseArgs(argv) {
  const flags = {};
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (!a.startsWith("--")) continue;
    const key = a.slice(2);
    const next = argv[i + 1];
    if (next === undefined || next.startsWith("--")) flags[key] = true;
    else {
      flags[key] = next;
      i++;
    }
  }
  return flags;
}

const stamp = () => new Date().toISOString().slice(0, 16).replace("T", " ");
const defaultLabel = () => `dev-${new Date().toISOString().slice(0, 16).replace(/[-:T]/g, "")}`;

function metaOf(flags) {
  const meta = {};
  for (const k of ["commit", "pr", "title", "env"]) if (typeof flags[k] === "string") meta[k] = flags[k];
  if (meta.commit) meta.sha = meta.commit.slice(0, 7);
  meta.at = stamp();
  return meta;
}

async function main() {
  const argv = process.argv.slice(2);
  // 첫 인자가 --로 시작하면 명령이 아니라 옵션이다. --help 를 명령으로 오해하면 안 된다.
  const command = argv[0] && !argv[0].startsWith("--") ? argv[0] : null;
  const flags = parseArgs(command ? argv.slice(1) : argv);

  if (!command || flags.help) {
    console.log(USAGE);
    return 0;
  }
  if (command !== "snapshot" && command !== "changelog") {
    console.error(`모르는 명령입니다: ${command}\n\n${USAGE}`);
    return 2;
  }

  const label = typeof flags.label === "string" ? flags.label : defaultLabel();
  const meta = metaOf(flags);

  const spec = await fetchSpec({ force: true });

  if (command === "snapshot") {
    const file = await saveSnapshot(label, spec, meta);
    console.log(`스냅샷 저장: ${label}\n  ${file}`);
    return 0;
  }

  // 직전 배포가 비교 대상이다. 오래된 것부터 정렬돼 있어 마지막이 직전이다.
  const previous = (await listEntries()).at(-1);
  await saveSnapshot(label, spec, meta);

  if (!previous) {
    console.log(`비교할 이전 스냅샷이 없어 기준점만 잡았습니다: ${label}`);
    return 0;
  }

  const before = await loadSnapshot(previous.label);
  const report = formatChangelog(before, spec, { ...meta, title: meta.title || `${previous.label} → ${label}` });
  console.log(report);

  if (slackConfigured && !flags["no-slack"]) {
    const result = await send(report);
    console.log(result.sent ? "\n슬랙으로 보냈습니다." : `\n슬랙 전송 안 됨: ${result.reason}`);
  }

  const { breaks } = summarize(before, spec);

  // dev 는 배포가 잦아 기본은 알리기만 한다. 막고 싶을 때만 켠다.
  if (flags["fail-on-breaking"] && breaks) {
    console.error(`\n호환성이 깨지는 변경 ${breaks}건이라 실패로 끝냅니다.`);
    return 1;
  }
  return 0;
}

main()
  .then((code) => process.exit(code))
  .catch((e) => {
    console.error(e.message);
    process.exit(1);
  });
