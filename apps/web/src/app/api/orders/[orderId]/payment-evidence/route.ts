import { cookies } from "next/headers";
import type { NextRequest } from "next/server";

type RouteContext = {
  params: Promise<{ orderId: string }>;
};

async function getAccessToken(): Promise<string | null> {
  return (await cookies()).get("accessToken")?.value?.trim() || null;
}

function gatewayUrl(orderId: string): string {
  const baseUrl = process.env.API_GATEWAY_URL ?? "http://localhost:3000";
  return `${baseUrl}/orders/${encodeURIComponent(orderId)}/payment-evidence`;
}

async function forwardError(response: Response): Promise<Response> {
  try {
    return Response.json(await response.json(), { status: response.status });
  } catch {
    return Response.json(
      { error: "Payment evidence request failed" },
      { status: response.status },
    );
  }
}

export async function POST(
  request: NextRequest,
  context: RouteContext,
): Promise<Response> {
  const accessToken = await getAccessToken();
  if (!accessToken) {
    return Response.json({ error: "Not authenticated" }, { status: 401 });
  }

  let formData: FormData;
  try {
    formData = await request.formData();
  } catch {
    return Response.json({ error: "Invalid payment evidence form" }, { status: 400 });
  }

  const { orderId } = await context.params;
  let response: Response;
  try {
    response = await fetch(gatewayUrl(orderId), {
      method: "POST",
      headers: { authorization: `Bearer ${accessToken}` },
      body: formData,
      signal: AbortSignal.timeout(20_000),
    });
  } catch {
    return Response.json({ error: "Service unavailable" }, { status: 503 });
  }

  if (!response.ok) {
    return forwardError(response);
  }
  try {
    return Response.json(await response.json(), { status: response.status });
  } catch {
    return Response.json(
      { error: "Invalid payment evidence response" },
      { status: 502 },
    );
  }
}

export async function GET(
  _request: NextRequest,
  context: RouteContext,
): Promise<Response> {
  const accessToken = await getAccessToken();
  if (!accessToken) {
    return Response.json({ error: "Not authenticated" }, { status: 401 });
  }

  const { orderId } = await context.params;
  let response: Response;
  try {
    response = await fetch(gatewayUrl(orderId), {
      method: "GET",
      headers: { authorization: `Bearer ${accessToken}` },
      cache: "no-store",
      signal: AbortSignal.timeout(15_000),
    });
  } catch {
    return Response.json({ error: "Service unavailable" }, { status: 503 });
  }

  if (!response.ok) {
    return forwardError(response);
  }
  if (!response.body) {
    return Response.json({ error: "Invalid payment evidence response" }, { status: 502 });
  }

  const headers = new Headers({
    "Cache-Control": "private, no-store",
    "X-Content-Type-Options": "nosniff",
  });
  for (const name of ["content-type", "content-disposition", "content-length"]) {
    const value = response.headers.get(name);
    if (value) {
      headers.set(name, value);
    }
  }
  return new Response(response.body, {
    status: response.status,
    headers,
  });
}
