import { cookies } from "next/headers";

import { fetchApiGateway } from "./api-gateway-url";
import {
  clearSessionCookies,
  exchangeRefreshToken,
  setSessionCookies,
} from "./auth-session";

const PRIVATE_HEADERS = { "Cache-Control": "private, no-store" };

function jsonError(message: string, status: number): Response {
  return Response.json({ error: message }, {
    status,
    headers: PRIVATE_HEADERS,
  });
}

export async function proxyAdminPayments(
  path: string,
  stream = false,
  method: "GET" | "POST" | "PATCH" | "DELETE" = "GET",
  body?: string,
  extraHeaders: Record<string, string> = {},
): Promise<Response> {
  const cookieStore = await cookies();
  let accessToken = cookieStore.get("accessToken")?.value?.trim() ?? "";
  const refreshToken = cookieStore.get("refreshToken")?.value?.trim() ?? "";
  const gatewayUrl = process.env.API_GATEWAY_URL ?? "http://localhost:3000";
  const sendRequest = (token: string) =>
    fetchApiGateway(`${gatewayUrl.replace(/\/$/, "")}${path}`, {
      method,
      headers: {
        authorization: ["Bearer", token].join(" "),
        ...extraHeaders,
        ...(body !== undefined ? { "content-type": "application/json" } : {}),
      },
      ...(body !== undefined ? { body } : {}),
      cache: "no-store",
      signal: AbortSignal.timeout(15_000),
    });

  let upstream: Response | null = null;
  if (accessToken) {
    try {
      upstream = await sendRequest(accessToken);
    } catch {
      return jsonError("Service unavailable", 503);
    }
  }

  if (!upstream || upstream.status === 401) {
    if (!refreshToken) {
      await clearSessionCookies();
      return jsonError("Session expired", 401);
    }

    const refreshed = await exchangeRefreshToken(
      gatewayUrl,
      refreshToken,
      (input, init) =>
        fetchApiGateway(input, {
          ...init,
          signal: AbortSignal.timeout(15_000),
        }),
    );
    if (refreshed.status === "unauthenticated") {
      await clearSessionCookies();
      return jsonError("Session expired", 401);
    }
    if (refreshed.status === "unavailable") {
      return jsonError("Service unavailable", 503);
    }

    accessToken = refreshed.tokens.accessToken;
    await setSessionCookies(refreshed.tokens);
    try {
      upstream = await sendRequest(accessToken);
    } catch {
      return jsonError("Service unavailable", 503);
    }
  }

  if (!upstream) {
    return jsonError("Service unavailable", 503);
  }
  if (upstream.status === 401) {
    await clearSessionCookies();
  }

  if (stream) {
    if (!upstream.ok) {
      return await forwardJson(upstream);
    }

    const contentType = upstream.headers.get("content-type");
    const contentDisposition = upstream.headers.get("content-disposition");
    if (
      !upstream.body ||
      (contentType !== "application/pdf" &&
        contentType !== "image/jpeg" &&
        contentType !== "image/png") ||
      !contentDisposition?.startsWith("attachment;")
    ) {
      return jsonError("Invalid payment evidence response", 502);
    }

    const headers = new Headers({
      "Cache-Control": "private, no-store",
      "X-Content-Type-Options": "nosniff",
      "Content-Type": contentType,
      "Content-Disposition": contentDisposition,
    });
    const contentLength = upstream.headers.get("content-length");
    if (contentLength && /^\d+$/.test(contentLength)) {
      headers.set("Content-Length", contentLength);
    }
    return new Response(upstream.body, {
      status: upstream.status,
      headers,
    });
  }

  return await forwardJson(upstream);
}

async function forwardJson(upstream: Response): Promise<Response> {
  try {
    return Response.json(await upstream.json(), {
      status: upstream.status,
      headers: PRIVATE_HEADERS,
    });
  } catch {
    return jsonError(
      upstream.ok ? "Invalid payment review response" : "Payment review request failed",
      upstream.ok ? 502 : upstream.status,
    );
  }
}
