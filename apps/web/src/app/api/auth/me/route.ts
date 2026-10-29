import { cookies } from "next/headers";

/**
 * GET /api/auth/me
 *
 * Returns the authenticated customer's profile by forwarding the httpOnly
 * accessToken cookie to the API gateway as an Authorization header.
 * Returns 401 when no session cookie is present or the token is invalid.
 */
export async function GET() {
  const cookieStore = await cookies();
  const token = cookieStore.get("accessToken")?.value;

  if (!token) {
    return Response.json({ error: "Not authenticated" }, { status: 401 });
  }

  const gatewayUrl = process.env.API_GATEWAY_URL ?? "http://localhost:3000";

  let res: Response;
  try {
    res = await fetch(`${gatewayUrl}/auth/me`, {
      headers: { authorization: `Bearer ${token}` },
    });
  } catch {
    return Response.json({ error: "Not authenticated" }, { status: 401 });
  }

  if (!res.ok) {
    return Response.json({ error: "Not authenticated" }, { status: 401 });
  }

  const data: unknown = await res.json();
  return Response.json(data);
}
