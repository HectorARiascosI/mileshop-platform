import { cookies } from "next/headers";

import { getApiGatewayEndpoint } from "@/lib/api-gateway-url";

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
    res = await fetch(endpoint, {
      headers: { authorization: `Bearer ${token}` },
    });
  } catch {
    return Response.json({ error: "Service unavailable" }, { status: 503 });
  }

  if (res.status === 401) {
    return Response.json({ error: "Not authenticated" }, { status: 401 });
  }

  if (!res.ok) {
    return Response.json({ error: "Service unavailable" }, { status: 503 });
  }

  const data: unknown = await res.json();
  return Response.json(data);
}
