import { NextRequest } from "next/server";

import { getApiGatewayEndpoint } from "@/lib/api-gateway-url";
import {
  isValidEmail,
  isValidPassword,
  isValidPhone,
  normalizeEmail,
  parseJsonBody,
  setSessionCookies,
} from "@/lib/auth-session";

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

  const payload = body as { name?: string; phone?: string; email?: string; password?: string };
  const name = payload.name?.trim() ?? "";
  const phone = payload.phone?.trim() ?? "";
  const email = normalizeEmail(payload.email ?? "");
  const password = typeof payload.password === "string" ? payload.password : "";

  if (name.length < 2) {
    return Response.json({ error: "Name must contain at least 2 characters" }, { status: 400 });
  }

  if (!isValidPhone(phone)) {
    return Response.json({ error: "Phone number is not valid" }, { status: 400 });
  }

  if (!isValidEmail(email) || !isValidPassword(password, 8)) {
    return Response.json({ error: "Email and password are required" }, { status: 400 });
  }

  const endpoint = getApiGatewayEndpoint("/auth/register");
  if (!endpoint) {
    return Response.json({ error: "Backend is not configured" }, { status: 503 });
  }

  let res: Response;
  try {
    res = await fetch(endpoint, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ email, password, name, phone }),
    });
  } catch {
    return Response.json({ error: "Service unavailable" }, { status: 503 });
  }

  if (res.status === 409) {
    return Response.json({ error: "Email already registered" }, { status: 409 });
  }

  if (res.status >= 500) {
    return Response.json({ error: "Service unavailable" }, { status: 503 });
  }

  if (!res.ok) {
    return Response.json({ error: "Registration failed" }, { status: 500 });
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

  return Response.json(
    { customerId: data.customerId, email: data.email, name: data.name },
    { status: 201 },
  );
}
