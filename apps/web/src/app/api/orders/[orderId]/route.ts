import { cookies } from "next/headers";
import { NextRequest } from "next/server";

import { getApiGatewayEndpoint } from "@/lib/api-gateway-url";

type RouteContext = {
  params: Promise<{ orderId: string }>;
};

export async function GET(_request: NextRequest, { params }: RouteContext) {
  const cookieStore = await cookies();
  const accessToken = cookieStore.get("accessToken")?.value?.trim();

  if (!accessToken) {
    return Response.json({ error: "Not authenticated" }, { status: 401 });
  }

  const { orderId } = await params;
  const endpoint = getApiGatewayEndpoint(`/orders/${encodeURIComponent(orderId)}`);
  if (!endpoint) {
    return Response.json({ error: "Backend is not configured" }, { status: 503 });
  }

  let response: Response;
  try {
    response = await fetch(endpoint, {
      headers: { authorization: `Bearer ${accessToken}` },
      signal: AbortSignal.timeout(3_000),
    });
  } catch {
    return Response.json({ error: "Service unavailable" }, { status: 503 });
  }

  const data: unknown = await response.json().catch(() => null);
  return Response.json(data, { status: response.status });
}
