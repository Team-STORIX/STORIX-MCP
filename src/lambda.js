// CD 가 배포 직후에 부른다. 하는 일은 CLI 의 changelog 와 같다.
import { fetchSpec } from "./modules/swagger/spec.js";
import { saveSnapshot, loadSnapshot, listEntries } from "./modules/swagger/snapshots.js";
import { summarize, formatChangelog, formatSlackBody } from "./modules/swagger/diff.js";
import { send, configured as slackConfigured } from "./modules/report/slack.js";
import { buildChangelogPayload } from "./modules/swagger/changelog-slack.js";

const stamp = () => new Date().toISOString().slice(0, 16).replace("T", " ");
const defaultLabel = () => `dev-${new Date().toISOString().slice(0, 16).replace(/[-:T]/g, "")}`;

export async function handler(event = {}) {
  const label = event.label || defaultLabel();
  const meta = { at: stamp() };
  for (const k of ["commit", "pr", "title", "env", "author"]) if (event[k]) meta[k] = String(event[k]);
  if (meta.commit) meta.sha = meta.commit.slice(0, 7);

  const spec = await fetchSpec({ force: true });
  const previous = (await listEntries()).at(-1);
  await saveSnapshot(label, spec, meta);

  if (!previous) {
    return { label, baseline: true, message: "비교할 이전 스냅샷이 없어 기준점만 잡았습니다." };
  }

  const before = await loadSnapshot(previous.label);
  const report = formatChangelog(before, spec, { ...meta, title: meta.title || `${previous.label} → ${label}` });
  console.log(report);

  const { breaks, added, actionable } = summarize(before, spec);

  let slack = "미설정";
  if (slackConfigured && !event.noSlack) {
    const payload = buildChangelogPayload({
      env: meta.env,
      sha: meta.sha,
      pr: meta.pr,
      title: meta.title,
      author: meta.author,
      from: previous.label,
      to: label,
      breaks,
      added,
      actionable,
      body: formatSlackBody(before, spec),
    });
    const result = await send(payload);
    slack = result.sent ? "보냄" : `실패: ${result.reason}`;
  }

  return { label, from: previous.label, breaks, added, actionable, slack };
}
