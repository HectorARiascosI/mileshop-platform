import { cookies } from "next/headers";

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
  method: "GET" | "POST" = "GET",
  body?: string,
): Promise<Response> {
  const accessToken = (await cookies()).get("accessToken")?.value?.trim();
  if (!accessToken) {
    return jsonError("Not authenticated", 401);
  }

  const gatewayUrl = process.env.API_GATEWAY_URL ?? "http://localhost:3000";
  let upstream: Response;
  try {
    upstream = await fetch(`${gatewayUrl.replace(/\/$/, "")}${path}`, {
      method,
      headers: {
        authorization: `Bearer ${accessToken}`,
        ...(body !== undefined ? { "content-type": "application/json" } : {}),
      },
      ...(body !== undefined ? { body } : {}),
      cache: "no-store",
      signal: AbortSignal.timeout(15_000),
    });
  } catch {
    return jsonError("Service unavailable", 503);
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
