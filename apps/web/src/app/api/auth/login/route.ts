import { NextRequest } from "next/server";

import { getApiGatewayEndpoint } from "@/lib/api-gateway-url";
import { isValidEmail, normalizeEmail, parseJsonBody, setSessionCookies } from "@/lib/auth-session";

export async function POST(request: NextRequest) {
  let body: unknown;
  try {
    body = await parseJsonBody<unknown>(request);
  } catch {
    return Response.json({ error: "Request body is not valid JSON" }, { status: 400 });
  }

  if (!body || typeof body !== "object") {
    return Response.json({ error: "Invalid request body" }, { status: 400 });
  }

  const payload = body as { email?: string; password?: string };
  const email = normalizeEmail(payload.email ?? "");
  const password = typeof payload.password === "string" ? payload.password : "";

  if (!isValidEmail(email) || password.length < 1) {
    return Response.json({ error: "Email and password are required" }, { status: 400 });
  }

  const endpoint = getApiGatewayEndpoint("/auth/login");
  if (!endpoint) {
    return Response.json({ error: "Backend is not configured" }, { status: 503 });
  }

  let res: Response;
  try {
    res = await fetch(endpoint, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ email, password }),
    });
  } catch {
    return Response.json({ error: "Service unavailable" }, { status: 503 });
  }

  if (res.status === 401) {
    return Response.json({ error: "Invalid credentials" }, { status: 401 });
  }

  if (res.status >= 500) {
    return Response.json({ error: "Service unavailable" }, { status: 503 });
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

  await setSessionCookies({
    accessToken: data.accessToken,
    refreshToken: data.refreshToken,
  });

  return Response.json({ customerId: data.customerId, email: data.email, name: data.name });
}
