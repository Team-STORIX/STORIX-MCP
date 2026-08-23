import { z } from "zod";
import { text, namespaced } from "../../shared/mcp.js";
import { fetchSpec } from "../swagger/spec.js";
import { judge, formatVerdict } from "./verdict.js";
import { buildMessage, buildSlackMessage, send, configured, channelName } from "./slack.js";
import { GUIDE } from "./guide.js";

export const NAMESPACE = "report";

const REPORTER = process.env.STORIX_MCP_REPORTER || "";

const CASE_SCHEMA = {
  method: z.string().describe("HTTP 메서드"),
  path: z.string().describe("경로 템플릿 (예: /api/v1/topic-rooms)"),
  request: z.unknown().optional().describe("보낸 요청 바디"),
  query: z.record(z.unknown()).optional().describe("보낸 쿼리 파라미터"),
  status: z.union([z.string(), z.number()]).optional().describe("받은 HTTP 상태값"),
  response: z.unknown().optional().describe("받은 응답 바디"),
};

export function register(server) {
  const tool = namespaced(server, NAMESPACE);

  server.registerPrompt(
    NAMESPACE,
    {
      title: "오류 제보",
      description: `API가 기대와 다르게 동작할 때 어느 쪽 문제인지 가리고 ${channelName} 에 올리는 법.`,
    },
    () => ({ messages: [{ role: "user", content: { type: "text", text: GUIDE } }] })
  );

  tool(
    "check",
    {
      title: "어긋난 곳 판정",
      description:
        "API 호출이 기대와 다르게 동작할 때 스펙과 대조해 어느 쪽이 어긋났는지 가린다. " +
        "요청이 스펙과 다르면 프론트, 응답·에러 코드·상태값이 스펙과 다르면 백엔드로 본다. " +
        "'왜 안 되지', '이거 누구 문제야' 같은 상황에서 서로 넘겨짚기 전에 먼저 돌린다. 보내지는 않는다.",
      inputSchema: CASE_SCHEMA,
    },
    async (input) => {
      const spec = await fetchSpec();
      return text(formatVerdict(judge(spec, input), input));
    }
  );

  tool(
    "send",
    {
      title: "오류 제보 보내기",
      description:
        `판정을 붙여 ${channelName} 슬랙 채널에 제보를 올린다. 형식이 고정돼 있어 채널에 같은 모양으로 쌓인다. ` +
        "보내기 전에 사용자에게 내용을 확인받아라. 판정만 보고 싶으면 report_check를 쓴다.",
      inputSchema: {
        ...CASE_SCHEMA,
        symptom: z.string().describe("무슨 일이 일어났는지 한 줄 (예: 생성 버튼 누르면 400)"),
        expected: z.string().optional().describe("기대했던 동작"),
        reporter: z.string().optional().describe("제보자 이름. 없으면 STORIX_MCP_REPORTER 환경변수"),
        dryRun: z.boolean().optional().describe("true면 보내지 않고 올라갈 내용만 보여준다"),
      },
    },
    async ({ symptom, expected, reporter, dryRun, ...input }) => {
      const spec = await fetchSpec();
      const result = judge(spec, input);
      const data = {
        input,
        result,
        symptom,
        expected,
        reporter: reporter || REPORTER,
        specVersion: spec.info?.version,
      };
      const message = buildMessage(data);

      if (dryRun) return text(`올라갈 내용 (보내지 않음):\n\n${message}`);

      if (!configured) {
        return text(
          `슬랙 웹훅이 설정돼 있지 않아 보내지 못했습니다.\n` +
            `서버에 STORIX_SLACK_WEBHOOK_URL 을 넣어야 합니다. 아래 내용을 ${channelName} 에 직접 붙여넣으세요.\n\n${message}`
        );
      }

      const { sent, reason } = await send(buildSlackMessage(data));
      return text(sent ? `${channelName} 에 올렸습니다.\n\n${message}` : `${reason}\n\n올리려던 내용:\n\n${message}`);
    }
  );
}
