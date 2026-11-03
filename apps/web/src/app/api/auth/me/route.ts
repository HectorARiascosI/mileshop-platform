import { cookies } from "next/headers";

import { fetchApiGateway, getApiGatewayEndpoint } from "@/lib/api-gateway-url";
import { clearSessionCookies, setSessionCookies } from "@/lib/auth-session";

/**
 * GET /api/auth/me
 *
 * Returns the authenticated customer's profile by forwarding the httpOnly
 * accessToken cookie to the API gateway as an Authorization header.
 */
export async function GET() {
  const cookieStore = await cookies();
  const token = cookieStore.get("accessToken")?.value?.trim();

  if (!token) {
    return Response.json({ error: "Not authenticated" }, { status: 401 });
  }

  const endpoint = getApiGatewayEndpoint("/auth/me");
  if (!endpoint) {
    return Response.json({ error: "Backend is not configured" }, { status: 503 });
  }

  let res: Response;
  try {
    res = await fetchApiGateway(endpoint, {
      headers: { authorization: `Bearer ${token}` },
    });
  } catch {
    return Response.json({ error: "Service unavailable" }, { status: 503 });
  }

  if (res.status === 401) {
    const refreshToken = cookieStore.get("refreshToken")?.value?.trim();
    if (!refreshToken) {
      await clearSessionCookies();
      return Response.json({ error: "Not authenticated" }, { status: 401 });
    }

    const refreshEndpoint = getApiGatewayEndpoint("/auth/refresh");
    if (!refreshEndpoint) {
      return Response.json({ error: "Backend is not configured" }, { status: 503 });
    }

    try {
      const refreshResponse = await fetchApiGateway(refreshEndpoint, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ refreshToken }),
      });

      if (!refreshResponse.ok) {
        await clearSessionCookies();
        return Response.json({ error: "Session expired" }, { status: 401 });
      }

      const refreshed = (await refreshResponse.json()) as {
        accessToken?: string;
        refreshToken?: string;
      };
      if (!refreshed.accessToken || !refreshed.refreshToken) {
        await clearSessionCookies();
        return Response.json({ error: "Refresh failed" }, { status: 500 });
      }

      await setSessionCookies({
        accessToken: refreshed.accessToken,
        refreshToken: refreshed.refreshToken,
      });

      res = await fetchApiGateway(endpoint, {
        headers: { authorization: `Bearer ${refreshed.accessToken}` },
      });
    } catch {
      await clearSessionCookies();
      return Response.json({ error: "Service unavailable" }, { status: 503 });
    }
  }

  if (res.status === 401) {
    await clearSessionCookies();
    return Response.json({ error: "Session expired" }, { status: 401 });
  }

  if (!res.ok) {
    return Response.json({ error: "Service unavailable" }, { status: 503 });
  }

  const data: unknown = await res.json();
  return Response.json(data);
}
