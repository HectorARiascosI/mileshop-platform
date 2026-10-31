import type { NextRequest } from "next/server";

import { proxyAdminPayments } from "@/lib/admin-payments-proxy";

type RouteContext = {
  params: Promise<{ orderId: string }>;
};

export async function GET(
  _request: NextRequest,
  context: RouteContext,
): Promise<Response> {
  const { orderId } = await context.params;
  return proxyAdminPayments(`/admin/payments/${encodeURIComponent(orderId)}`);
}
