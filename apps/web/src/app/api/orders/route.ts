import { cookies } from "next/headers";
import { NextRequest } from "next/server";

import { getApiGatewayEndpoint } from "@/lib/api-gateway-url";

/**
 * POST /api/orders
 *
 * Server-side proxy for order creation. Reads the httpOnly accessToken cookie
 * and forwards it as an Authorization header to the API gateway.
 */
export async function POST(request: NextRequest) {
  const cookieStore = await cookies();
  const accessToken = cookieStore.get("accessToken")?.value?.trim();

  if (!accessToken) {
    return Response.json({ error: "Not authenticated" }, { status: 401 });
  }

  const idempotencyKey = request.headers.get("idempotency-key")?.trim();
  if (!idempotencyKey) {
    return Response.json({ error: "Missing Idempotency-Key header" }, { status: 400 });
  }

  const endpoint = getApiGatewayEndpoint("/orders");
  if (!endpoint) {
    return Response.json({ error: "Backend is not configured" }, { status: 503 });
  }

  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return Response.json({ error: "Invalid request body" }, { status: 400 });
  }

  let res: Response;
  try {
    res = await fetch(endpoint, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "idempotency-key": idempotencyKey,
        authorization: `Bearer ${accessToken}`,
      },
      body: JSON.stringify(body),
    });
  } catch {
    return Response.json({ error: "Service unavailable" }, { status: 503 });
  }

  const data: unknown = await res.json().catch(() => null);
  return Response.json(data, { status: res.status });
}
