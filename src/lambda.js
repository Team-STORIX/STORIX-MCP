// CD 가 배포 직후에 부른다. 하는 일은 CLI 의 changelog 와 같다.
import { fetchSpec } from "./modules/swagger/spec.js";
import { saveSnapshot, loadSnapshot, listEntries } from "./modules/swagger/snapshots.js";
import { diffSpecs, formatChangelog } from "./modules/swagger/diff.js";
import { send, configured as slackConfigured } from "./modules/report/slack.js";

const stamp = () => new Date().toISOString().slice(0, 16).replace("T", " ");
const defaultLabel = () => `dev-${new Date().toISOString().slice(0, 16).replace(/[-:T]/g, "")}`;

export async function handler(event = {}) {
  const label = event.label || defaultLabel();
  const meta = { at: stamp() };
  for (const k of ["commit", "pr", "title", "env"]) if (event[k]) meta[k] = String(event[k]);
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

  let slack = "미설정";
  if (slackConfigured && !event.noSlack) {
    const result = await send(report);
    slack = result.sent ? "보냄" : `실패: ${result.reason}`;
  }

  const { added, removed, changed } = diffSpecs(before, spec);
  const needsWork = removed.length + changed.filter((c) => c.breaking.length).length;

  return { label, from: previous.label, needsWork, added: added.length, slack };
}
