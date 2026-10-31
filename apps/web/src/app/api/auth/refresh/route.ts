import { cookies } from "next/headers";

import { getApiGatewayEndpoint } from "@/lib/api-gateway-url";
import { clearSessionCookies, setSessionCookies } from "@/lib/auth-session";

export async function POST() {
  const cookieStore = await cookies();
  const refreshToken = cookieStore.get("refreshToken")?.value?.trim();

  if (!refreshToken) {
    await clearSessionCookies();
    return Response.json({ error: "Not authenticated" }, { status: 401 });
  }

  const endpoint = getApiGatewayEndpoint("/auth/refresh");
  if (!endpoint) {
    return Response.json({ error: "Backend is not configured" }, { status: 503 });
  }

  let res: Response;
  try {
    res = await fetch(endpoint, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ refreshToken }),
    });
  } catch {
    return Response.json({ error: "Service unavailable" }, { status: 503 });
  }

  if (res.status === 401) {
    await clearSessionCookies();
    return Response.json({ error: "Session expired" }, { status: 401 });
  }

  if (res.status >= 500) {
    return Response.json({ error: "Service unavailable" }, { status: 503 });
  }

  if (!res.ok) {
    await clearSessionCookies();
    return Response.json({ error: "Session expired" }, { status: 401 });
  }

  const data = (await res.json()) as {
    accessToken?: string;
    refreshToken?: string;
  };

  if (!data.accessToken || !data.refreshToken) {
    await clearSessionCookies();
    return Response.json({ error: "Refresh failed" }, { status: 500 });
  }

  await setSessionCookies({
    accessToken: data.accessToken,
    refreshToken: data.refreshToken,
  });

  return Response.json({ ok: true });
}
