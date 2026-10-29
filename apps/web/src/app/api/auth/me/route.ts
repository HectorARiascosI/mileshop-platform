import { cookies } from "next/headers";

export async function GET() {
  const cookieStore = await cookies();
  const token = cookieStore.get("accessToken")?.value;

  if (!token) {
    return Response.json({ error: "Not authenticated" }, { status: 401 });
  }

  const identityUrl = process.env.IDENTITY_SERVICE_URL ?? "http://localhost:3040";

  let res: Response;
  try {
    res = await fetch(`${identityUrl}/auth/me`, {
      headers: { authorization: `Bearer ${token}` },
    });
  } catch {
    return Response.json({ error: "Not authenticated" }, { status: 401 });
  }

  if (!res.ok) {
    return Response.json({ error: "Not authenticated" }, { status: 401 });
  }

  const data = await res.json();
  return Response.json(data);
}
