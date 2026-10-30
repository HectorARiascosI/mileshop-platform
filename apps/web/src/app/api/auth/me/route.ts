import { cookies } from "next/headers";

import { clearSessionCookies, refreshSession } from "@/lib/auth-session";

/**
 * GET /api/auth/me
 *
 * Returns the authenticated customer's profile by forwarding the httpOnly
 * accessToken cookie to the API gateway as an Authorization header.
 * Refreshes expired access tokens without discarding a session on outages.
 */
export async function GET() {
  const gatewayUrl = process.env.API_GATEWAY_URL ?? "http://localhost:3000";
  let cookieStore = await cookies();
  let token = cookieStore.get("accessToken")?.value?.trim();

  if (!token) {
    const refreshResult = await refreshSession(gatewayUrl);
    if (refreshResult !== "refreshed") {
      return Response.json(
        { error: refreshResult === "unauthenticated" ? "Not authenticated" : "Identity service unavailable" },
        { status: refreshResult === "unauthenticated" ? 401 : 503 },
      );
    }
    cookieStore = await cookies();
    token = cookieStore.get("accessToken")?.value?.trim();
  }

  if (!token) {
    await clearSessionCookies();
    return Response.json({ error: "Not authenticated" }, { status: 401 });
  }

  let response: Response;
  try {
    response = await fetch(`${gatewayUrl}/auth/me`, {
      headers: { authorization: `Bearer ${token}` },
      signal: AbortSignal.timeout(3_000),
    });
  } catch {
    return Response.json({ error: "Identity service unavailable" }, { status: 503 });
  }

  if (response.status === 401) {
    const refreshResult = await refreshSession(gatewayUrl);
    if (refreshResult === "unauthenticated") {
      return Response.json({ error: "Not authenticated" }, { status: 401 });
    }
    if (refreshResult === "unavailable") {
      return Response.json({ error: "Identity service unavailable" }, { status: 503 });
    }

    cookieStore = await cookies();
    token = cookieStore.get("accessToken")?.value?.trim();
    if (!token) {
      await clearSessionCookies();
      return Response.json({ error: "Not authenticated" }, { status: 401 });
    }

    try {
      response = await fetch(`${gatewayUrl}/auth/me`, {
        headers: { authorization: `Bearer ${token}` },
        signal: AbortSignal.timeout(3_000),
      });
    } catch {
      return Response.json({ error: "Identity service unavailable" }, { status: 503 });
    }
  }

  if (response.status === 401) {
    await clearSessionCookies();
    return Response.json({ error: "Not authenticated" }, { status: 401 });
  }
  if (!response.ok) {
    return Response.json({ error: "Identity service unavailable" }, { status: 503 });
  }

  try {
    return Response.json(await response.json());
  } catch {
    return Response.json({ error: "Invalid identity service response" }, { status: 502 });
  }
}
