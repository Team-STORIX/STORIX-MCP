import { z } from "zod";
import { text, fail, namespaced } from "../../shared/mcp.js";
import {
  SCHEME,
  IOS_BUNDLE_ID,
  ANDROID_PACKAGE,
  hasCommand,
  androidDevices,
  bootedSimulators,
  androidHasApp,
  iosHasApp,
  pickTarget,
  deepLink,
  openDeepLink,
} from "./devices.js";
import { GUIDE } from "./guide.js";

export const NAMESPACE = "mobile";

export function register(server, { local = true } = {}) {
  // 기기를 만지는 일이라 그 사람 컴퓨터에서만 뜻이 있다. auth 가 원격에서 꺼지는 것과 같은 이유.
  if (!local) return;

  const tool = namespaced(server, NAMESPACE);

  server.registerPrompt(
    NAMESPACE,
    { title: "앱으로 확인하기", description: "딥링크로 화면 띄우기, Maestro 도입과 플로우 작성 규칙." },
    () => ({ messages: [{ role: "user", content: { type: "text", text: GUIDE } }] })
  );

  tool(
    "doctor",
    {
      title: "앱 확인 환경 점검",
      description:
        "설치된 도구와 연결된 기기를 보고 지금 어디까지 할 수 있는지 알려준다. " +
        "앱 관련 작업은 이걸 먼저 부르고 시작한다.",
      inputSchema: {},
    },
    async () => {
      const [maestro, adb, xcrun] = await Promise.all([
        hasCommand("maestro"),
        hasCommand("adb"),
        hasCommand("xcrun"),
      ]);
      const [android, ios] = await Promise.all([androidDevices(), bootedSimulators()]);

      const lines = ["도구", `  maestro  ${maestro ? "있음" : "없음"}`, `  adb      ${adb ? "있음" : "없음"}`, `  xcrun    ${xcrun ? "있음" : "없음"}`, "", "기기"];

      if (!android.length && !ios.length) {
        lines.push("  없음. 안드로이드 기기를 USB 로 연결하거나 iOS 시뮬레이터를 켜세요.");
      }
      for (const serial of android) {
        lines.push(`  android  ${serial}  앱 ${(await androidHasApp(serial)) ? "설치됨" : "없음"}`);
      }
      for (const sim of ios) {
        lines.push(`  ios      ${sim.name}  앱 ${(await iosHasApp(sim.udid)) ? "설치됨" : "없음"}`);
      }

      const hasDevice = Boolean(android.length || ios.length);
      lines.push("", "지금 할 수 있는 것");
      lines.push(`  API 검증      가능 (flow_run)`);
      lines.push(`  화면 띄우기   ${hasDevice ? "가능 (mobile_open)" : "기기가 없어 불가"}`);
      lines.push(`  실제 조작     ${maestro ? (hasDevice ? "가능" : "기기가 없어 불가") : "maestro 없음"}`);

      if (!maestro) {
        lines.push("", "Maestro 는 없어도 나머지는 그대로 됩니다. 필요하면:");
        lines.push(`  curl -Ls "https://get.maestro.mobile.dev" | bash`);
      }

      lines.push("", `설정  scheme ${SCHEME} · ios ${IOS_BUNDLE_ID} · android ${ANDROID_PACKAGE}`);
      return text(lines.join("\n"));
    }
  );

  tool(
    "open",
    {
      title: "앱 화면 띄우기",
      description:
        "딥링크로 앱의 해당 화면을 연다. 라우트는 FE 의 app/ 구조 그대로이고 (tabs) 같은 괄호 그룹은 주소에 넣지 않는다. " +
        "예: works/123, search, notifications. 화면 이동만 하며 버튼을 누르지는 못한다.",
      inputSchema: {
        route: z.string().describe("앱 라우트. 예: works/123"),
        platform: z.enum(["android", "ios"]).optional().describe("둘 다 붙어 있을 때 고를 쪽"),
      },
    },
    async ({ route, platform }) => {
      const { picked, all } = await pickTarget(platform);
      if (!picked) {
        return fail(
          "쏠 기기가 없습니다. 안드로이드 기기를 USB 로 연결하거나 iOS 시뮬레이터를 켜세요.\n" +
            "mobile_doctor 로 지금 환경을 볼 수 있습니다."
        );
      }

      const url = deepLink(route);
      const result = await openDeepLink(picked, url);
      if (!result.ok) return fail(`${url} 열기 실패 (${picked.platform} ${picked.label}): ${result.message}`);

      const others = all.length > 1 ? `\n다른 기기 ${all.length - 1}대가 더 있습니다. platform 으로 고를 수 있습니다.` : "";
      return text(`${url}\n${picked.platform} ${picked.label} 에서 열었습니다.${others}`);
    }
  );
}
