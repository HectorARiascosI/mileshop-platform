import { NextRequest } from "next/server";
import { cookies } from "next/headers";

export async function POST(request: NextRequest) {
  const body = await request.json();
  const gatewayUrl = process.env.API_GATEWAY_URL ?? "http://localhost:3000";

  let res: Response;
  try {
    res = await fetch(`${gatewayUrl}/auth/login`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body),
    });
  } catch {
    return Response.json({ error: "Login failed" }, { status: 500 });
  }

  if (res.status === 401) {
    return Response.json({ error: "Invalid credentials" }, { status: 401 });
  }

  if (!res.ok) {
    return Response.json({ error: "Login failed" }, { status: 500 });
  }

  const data = (await res.json()) as {
    customerId: string;
    email: string;
    name: string;
    accessToken: string;
    refreshToken: string;
  };

  const cookieStore = await cookies();
  cookieStore.set("accessToken", data.accessToken, {
    httpOnly: true,
    secure: process.env.NODE_ENV === "production",
    sameSite: "lax",
    path: "/",
    maxAge: 15 * 60,
  });
  cookieStore.set("refreshToken", data.refreshToken, {
    httpOnly: true,
    secure: process.env.NODE_ENV === "production",
    sameSite: "lax",
    path: "/",
    maxAge: 30 * 24 * 60 * 60,
  });

  return Response.json({ customerId: data.customerId, email: data.email, name: data.name });
}
