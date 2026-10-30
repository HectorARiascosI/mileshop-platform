import { cookies } from "next/headers";
import { NextRequest } from "next/server";

/**
 * POST /api/orders
 *
 * Server-side proxy for order creation. Reads the httpOnly accessToken cookie
 * and forwards it as an Authorization header to the API gateway, so the
 * client-side cart never needs direct access to the token.
 *
 * Body: { lines: OrderLineInput[] }
 * The customerId is NOT sent by the client — the gateway overwrites it from
 * the verified JWT payload via AuthMiddleware.
 */
export async function POST(request: NextRequest) {
  const cookieStore = await cookies();
  const accessToken = cookieStore.get("accessToken")?.value;

  if (!accessToken) {
    return Response.json({ error: "Not authenticated" }, { status: 401 });
  }

  const gatewayUrl = process.env.API_GATEWAY_URL ?? "http://localhost:3000";

  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return Response.json({ error: "Invalid request body" }, { status: 400 });
  }

  let res: Response;
  try {
    const idempotencyKey = request.headers.get("idempotency-key");
    res = await fetch(`${gatewayUrl}/orders`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        ...(idempotencyKey ? { "Idempotency-Key": idempotencyKey } : {}),
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
