import type { NextRequest } from "next/server";

import { proxyAdminPayments } from "@/lib/admin-payments-proxy";

type RouteContext = {
  params: Promise<{ orderId: string }>;
};

export async function POST(
  request: NextRequest,
  context: RouteContext,
): Promise<Response> {
  const { orderId } = await context.params;
  const body = await request.text();
  return proxyAdminPayments(
    `/admin/payments/${encodeURIComponent(orderId)}/reject`,
    false,
    "POST",
    body,
  );
}
