import type { FastifyInstance, HTTPMethods } from "fastify";
import type { IncomingMessage, ServerResponse } from "node:http";

const MAX_REQUEST_BODY_BYTES = 4_500_000;
const allowedMethods = new Set<HTTPMethods>([
  "CONNECT",
  "DELETE",
  "GET",
  "HEAD",
  "OPTIONS",
  "PATCH",
  "POST",
  "PUT",
  "TRACE",
]);

export async function handleFastifyRequest(
  app: FastifyInstance,
  request: IncomingMessage,
  response: ServerResponse,
): Promise<void> {
  const method = request.method;
  if (!method || !allowedMethods.has(method as HTTPMethods)) {
    response.statusCode = 405;
    response.setHeader("content-type", "application/json; charset=utf-8");
    response.end(JSON.stringify({ statusCode: 405, message: "Method not allowed" }));
    return;
  }

  const body = await readRequestBody(request);
  if (body === null) {
    response.statusCode = 413;
    response.setHeader("content-type", "application/json; charset=utf-8");
    response.end(JSON.stringify({ statusCode: 413, message: "Request body is too large" }));
    return;
  }

  const headers: Record<string, string | string[]> = {};
  for (const [name, value] of Object.entries(request.headers)) {
    if (value !== undefined && name !== "content-length" && name !== "transfer-encoding") {
      headers[name] = value;
    }
  }

  const url = new URL(request.url ?? "/", "http://localhost");
  if (url.pathname === "/api") {
    url.pathname = "/";
  } else if (url.pathname.startsWith("/api/")) {
    url.pathname = url.pathname.slice("/api".length);
  }

  const result = await app.inject({
    method: method as HTTPMethods,
    url: `${url.pathname}${url.search}`,
    headers,
    ...(body === undefined ? {} : { payload: body }),
  });

  response.statusCode = result.statusCode;
  for (const [name, value] of Object.entries(result.headers)) {
    if (typeof value === "string" || Array.isArray(value)) {
      response.setHeader(name, value);
    }
  }
  response.end(result.rawPayload);
}

async function readRequestBody(request: IncomingMessage): Promise<Buffer | undefined | null> {
  const contentLength = Number(request.headers["content-length"]);
  if (Number.isFinite(contentLength) && contentLength > MAX_REQUEST_BODY_BYTES) {
    request.resume();
    return null;
  }

  const chunks: Buffer[] = [];
  let totalBytes = 0;
  for await (const chunk of request) {
    const buffer = Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk);
    totalBytes += buffer.length;
    if (totalBytes > MAX_REQUEST_BODY_BYTES) {
      request.resume();
      return null;
    }
    chunks.push(buffer);
  }

  return totalBytes === 0 ? undefined : Buffer.concat(chunks, totalBytes);
}
