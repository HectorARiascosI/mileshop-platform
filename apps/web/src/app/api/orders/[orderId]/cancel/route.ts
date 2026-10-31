import { cookies } from "next/headers";
import type { NextRequest } from "next/server";

type RouteContext = {
  params: Promise<{ orderId: string }>;
};

export async function POST(
  _request: NextRequest,
  context: RouteContext,
): Promise<Response> {
  const accessToken = (await cookies()).get("accessToken")?.value?.trim();
  if (!accessToken) {
    return Response.json(
      { error: "Not authenticated" },
      { status: 401, headers: { "Cache-Control": "private, no-store" } },
    );
  }

  const { orderId } = await context.params;
  const gatewayUrl = process.env.API_GATEWAY_URL ?? "http://localhost:3000";
  let response: Response;
  try {
    response = await fetch(
      `${gatewayUrl}/orders/${encodeURIComponent(orderId)}/cancel`,
      {
        method: "POST",
        headers: { authorization: "Bearer " + accessToken },
        cache: "no-store",
        signal: AbortSignal.timeout(10_000),
      },
    );
  } catch {
    return Response.json(
      { error: "Service unavailable" },
      { status: 503, headers: { "Cache-Control": "private, no-store" } },
    );
  }

  const headers = { "Cache-Control": "private, no-store" };
  try {
    return Response.json(await response.json(), {
      status: response.status,
      headers,
    });
  } catch {
    return Response.json(
      { error: "Invalid order cancellation response" },
      { status: response.ok ? 502 : response.status, headers },
    );
  }
}
