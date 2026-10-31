import { cookies } from "next/headers";

export const ACCESS_TOKEN_TTL_SECONDS = 15 * 60;
export const REFRESH_TOKEN_TTL_SECONDS = 30 * 24 * 60 * 60;

export type SessionTokens = {
  accessToken: string;
  refreshToken: string;
};

export function isValidEmail(value: string): boolean {
  return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(value.trim());
}

export function normalizeEmail(value: string): string {
  return value.trim().toLowerCase();
}

export function isValidPassword(value: string, minLength = 8): boolean {
  return value.length >= minLength;
}

export function isValidPhone(value: string): boolean {
  const trimmed = value.trim();
  return trimmed.length >= 7 && /^[0-9+()\s-]+$/.test(trimmed);
}

export function parseJsonBody<T>(request: Request): Promise<T> {
  return request.json() as Promise<T>;
}

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
  fetcher: typeof fetch = fetch,
): Promise<
  | { status: "refreshed"; tokens: SessionTokens }
  | { status: "unauthenticated" }
  | { status: "unavailable" }
> {
  try {
    const response = await fetcher(`${gatewayUrl.replace(/\/$/, "")}/auth/refresh`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ refreshToken }),
    });

    if (response.status === 401) {
      return { status: "unauthenticated" };
    }
    if (!response.ok) {
      return { status: "unavailable" };
    }

    const data = await response.json() as Partial<SessionTokens>;
    if (
      typeof data.accessToken !== "string" ||
      data.accessToken.length === 0 ||
      typeof data.refreshToken !== "string" ||
      data.refreshToken.length === 0
    ) {
      return { status: "unavailable" };
    }

    return {
      status: "refreshed",
      tokens: {
        accessToken: data.accessToken,
        refreshToken: data.refreshToken,
      },
    };
  } catch {
    return { status: "unavailable" };
  }
}
