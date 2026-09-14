// 서버 응답을 그대로 되돌려줄 때 비밀값이 대화에 남지 않게 가린다.
// 응답 형태가 예상과 다를 때 원문을 보여주는 게 진단에 도움이 되는데,
// 그 원문에 토큰이 들어 있을 수 있어서 필요한 장치다.

const SECRET_KEYS =
  "accessToken|refreshToken|oauthRefreshToken|password|encodedPassword|pendingId|token|secret|apiKey|authorization";

const RULES = [
  // JWT 형태
  [/\beyJ[\w-]{8,}\.[\w-]{8,}\.[\w-]{4,}/g, "<가림:jwt>"],
  // "accessToken": "..." 같은 JSON 필드
  [new RegExp(`("(?:${SECRET_KEYS})"\\s*:\\s*")[^"]{4,}(")`, "gi"), "$1<가림>$2"],
  // Bearer 헤더
  [/\bBearer\s+[\w.\-]{8,}/gi, "Bearer <가림>"],
  // Basic 헤더
  [/\bBasic\s+[A-Za-z0-9+/=]{8,}/g, "Basic <가림>"],
];

export function redact(value) {
  if (value == null) return value;
  let out = typeof value === "string" ? value : JSON.stringify(value);
  for (const [pattern, replacement] of RULES) out = out.replace(pattern, replacement);
  return out;
}
