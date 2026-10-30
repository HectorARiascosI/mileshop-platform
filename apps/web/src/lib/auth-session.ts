import { cookies } from "next/headers";

export const ACCESS_TOKEN_TTL_SECONDS = 15 * 60;
export const REFRESH_TOKEN_TTL_SECONDS = 30 * 24 * 60 * 60;

export type SessionTokens = {
  accessToken: string;
  refreshToken: string;
};

export type RefreshSessionResult = "refreshed" | "unauthenticated" | "unavailable";
export type RefreshExchangeResult =
  | { status: "refreshed"; tokens: SessionTokens }
  | { status: "unauthenticated" }
  | { status: "unavailable" };

type FetchLike = (input: string, init?: RequestInit) => Promise<Response>;

export async function setSessionCookies({ accessToken, refreshToken }: SessionTokens): Promise<void> {
  const cookieStore = await cookies();
  const secure = process.env.NODE_ENV === "production";

  cookieStore.set("accessToken", accessToken, {
    httpOnly: true,
    secure,
    sameSite: "lax",
    path: "/",
    maxAge: ACCESS_TOKEN_TTL_SECONDS,
  });

  cookieStore.set("refreshToken", refreshToken, {
    httpOnly: true,
    secure,
    sameSite: "lax",
    path: "/",
    maxAge: REFRESH_TOKEN_TTL_SECONDS,
  });
}

export async function clearSessionCookies(): Promise<void> {
  const cookieStore = await cookies();
  cookieStore.delete("accessToken");
  cookieStore.delete("refreshToken");
}

export async function exchangeRefreshToken(
  gatewayUrl: string,
  refreshToken: string,
  fetcher: FetchLike = fetch,
): Promise<RefreshExchangeResult> {
  let response: Response;
  try {
    response = await fetcher(`${gatewayUrl}/auth/refresh`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ refreshToken }),
      signal: AbortSignal.timeout(3_000),
    });
  } catch {
    return { status: "unavailable" };
  }

  if (response.status === 401) {
    return { status: "unauthenticated" };
  }
  if (!response.ok) {
    return { status: "unavailable" };
  }

  let tokens: unknown;
  try {
    tokens = await response.json();
  } catch {
    return { status: "unavailable" };
  }

  if (
    !tokens ||
    typeof tokens !== "object" ||
    !("accessToken" in tokens) ||
    typeof tokens.accessToken !== "string" ||
    !tokens.accessToken ||
    !("refreshToken" in tokens) ||
    typeof tokens.refreshToken !== "string" ||
    !tokens.refreshToken
  ) {
    return { status: "unavailable" };
  }

  return {
    status: "refreshed",
    tokens: { accessToken: tokens.accessToken, refreshToken: tokens.refreshToken },
  };
}

export async function refreshSession(gatewayUrl: string): Promise<RefreshSessionResult> {
  const cookieStore = await cookies();
  const refreshToken = cookieStore.get("refreshToken")?.value?.trim();

  if (!refreshToken) {
    await clearSessionCookies();
    return "unauthenticated";
  }

  const result = await exchangeRefreshToken(gatewayUrl, refreshToken);
  if (result.status === "unauthenticated") {
    await clearSessionCookies();
    return result.status;
  }
  if (result.status === "unavailable") {
    return result.status;
  }

  await setSessionCookies(result.tokens);
  return result.status;
}
