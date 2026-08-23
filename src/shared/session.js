// 발급받은 토큰을 프로세스 안에서만 들고 있는다. 디스크에 쓰지 않는다.
let session = null;

export function setSession(next) {
  session = next;
}

export function getSession() {
  return session;
}

export function clearSession() {
  session = null;
}

// 서명은 확인하지 않는다. 만료 시각만 보려는 것이다.
export function expiryOf(accessToken) {
  try {
    const [, payload] = accessToken.split(".");
    const json = JSON.parse(Buffer.from(payload, "base64url").toString("utf8"));
    return typeof json.exp === "number" ? json.exp * 1000 : null;
  } catch {
    return null;
  }
}

export function remainingText(expiresAt) {
  if (!expiresAt) return "만료 시각 알 수 없음";
  const ms = expiresAt - Date.now();
  if (ms <= 0) return "만료됨";
  const min = Math.floor(ms / 60000);
  return min >= 60 ? `${Math.floor(min / 60)}시간 ${min % 60}분 남음` : `${min}분 남음`;
}

// accessToken이 만료되면 refreshToken으로 다시 받는다.
// 재발급도 실패하면 세션을 버린다 - 낡은 토큰을 들고 계속 시도해봐야 소용없다.
export async function refreshSession(baseUrl) {
  const current = session;
  if (!current?.refreshToken) return false;

  let res;
  try {
    res = await fetch(`${baseUrl}/api/v1/auth/tokens/refresh`, {
      method: "POST",
      headers: { "Content-Type": "application/json", Accept: "application/json" },
      body: JSON.stringify({ refreshToken: current.refreshToken }),
    });
  } catch {
    return false;
  }

  if (!res.ok) {
    clearSession();
    return false;
  }

  const tokens = (await res.json().catch(() => null))?.result;
  if (!tokens?.accessToken) {
    clearSession();
    return false;
  }

  session = { ...current, ...tokens, expiresAt: expiryOf(tokens.accessToken) };
  return true;
}

export function isExpired() {
  return Boolean(session?.expiresAt && session.expiresAt <= Date.now());
}
