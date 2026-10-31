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
  return proxyAdminPayments(
    `/admin/cancellation-requests/${encodeURIComponent(orderId)}/resolve`,
    false,
    "POST",
    await request.text(),
  );
}
