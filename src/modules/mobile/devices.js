import { execFile } from "node:child_process";
import { promisify } from "node:util";

const run = promisify(execFile);

export const SCHEME = process.env.STORIX_APP_SCHEME || "storixfe21";
export const IOS_BUNDLE_ID = process.env.STORIX_APP_IOS_BUNDLE_ID || "kr.storix.app";
export const ANDROID_PACKAGE = process.env.STORIX_APP_ANDROID_PACKAGE || "kr.storix.android";

const TIMEOUT_MS = 15_000;

async function exec(file, args) {
  try {
    const { stdout } = await run(file, args, { timeout: TIMEOUT_MS });
    return { ok: true, stdout };
  } catch (e) {
    return { ok: false, stdout: e.stdout || "", message: e.message };
  }
}

export async function hasCommand(name) {
  const { ok } = await exec("/bin/sh", ["-c", `command -v ${name}`]);
  return ok;
}

// adb devices 는 승인 대기·오프라인 기기도 같이 보여준다. 실제로 쏠 수 있는 건 device 상태뿐이다.
export async function androidDevices() {
  const { ok, stdout } = await exec("adb", ["devices"]);
  if (!ok) return [];
  return stdout
    .split("\n")
    .slice(1)
    .map((l) => l.trim().split(/\s+/))
    .filter(([serial, state]) => serial && state === "device")
    .map(([serial]) => serial);
}

export async function bootedSimulators() {
  const { ok, stdout } = await exec("xcrun", ["simctl", "list", "devices", "booted", "-j"]);
  if (!ok) return [];
  try {
    const byRuntime = JSON.parse(stdout).devices || {};
    return Object.values(byRuntime)
      .flat()
      .map((d) => ({ udid: d.udid, name: d.name }));
  } catch {
    return [];
  }
}

export async function androidHasApp(serial) {
  const { ok, stdout } = await exec("adb", ["-s", serial, "shell", "pm", "list", "packages", ANDROID_PACKAGE]);
  return ok && stdout.includes(ANDROID_PACKAGE);
}

export async function iosHasApp(udid) {
  const { ok } = await exec("xcrun", ["simctl", "get_app_container", udid, IOS_BUNDLE_ID]);
  return ok;
}

// 쏠 대상을 고른다. 안드로이드 실기기가 붙어 있으면 그쪽이 우선이고, 없으면 부팅된 시뮬레이터.
export async function pickTarget(prefer) {
  const [android, ios] = await Promise.all([androidDevices(), bootedSimulators()]);
  const androidTargets = android.map((serial) => ({ platform: "android", id: serial, label: serial }));
  const iosTargets = ios.map((d) => ({ platform: "ios", id: d.udid, label: d.name }));
  const all = prefer === "ios" ? [...iosTargets, ...androidTargets] : [...androidTargets, ...iosTargets];
  return { picked: all[0] || null, all };
}

export function deepLink(route) {
  const clean = String(route).replace(/^\/+/, "");
  return `${SCHEME}://${clean}`;
}

export async function openDeepLink(target, url) {
  if (target.platform === "android") {
    const r = await exec("adb", ["-s", target.id, "shell", "am", "start", "-a", "android.intent.action.VIEW", "-d", url]);
    // am start 는 앱이 못 받아도 종료코드 0 으로 끝나는 경우가 있어 출력을 같이 본다
    if (r.ok && /Error|Warning: Activity not started/i.test(r.stdout)) {
      return { ok: false, message: r.stdout.trim() };
    }
    return r.ok ? { ok: true } : { ok: false, message: r.message };
  }
  const r = await exec("xcrun", ["simctl", "openurl", target.id, url]);
  return r.ok ? { ok: true } : { ok: false, message: r.message };
}
