import type { NextRequest } from "next/server";

import { proxyAdminPayments } from "@/lib/admin-payments-proxy";

export async function POST(request: NextRequest): Promise<Response> {
  const idempotencyKey = request.headers.get("idempotency-key")?.trim();
  if (!idempotencyKey || idempotencyKey.length > 128) {
    return Response.json(
      { error: "A valid Idempotency-Key header is required" },
      { status: 400, headers: { "Cache-Control": "private, no-store" } },
    );
  }
  return proxyAdminPayments(
    "/admin/catalog/stock-receipts",
    false,
    "POST",
    await request.text(),
    { "idempotency-key": idempotencyKey },
  );
}
