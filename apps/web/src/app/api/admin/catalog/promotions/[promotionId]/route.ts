import { proxyAdminPayments } from "@/lib/admin-payments-proxy";

export async function PATCH(
  request: Request,
  context: { params: Promise<{ promotionId: string }> },
): Promise<Response> {
  const { promotionId } = await context.params;
  if (!promotionId.trim()) {
    return Response.json(
      { error: "Promotion id is required" },
      { status: 400, headers: { "Cache-Control": "private, no-store" } },
    );
  }
  return proxyAdminPayments(
    `/admin/catalog/promotions/${encodeURIComponent(promotionId)}`,
    false,
    "PATCH",
    await request.text(),
  );
}

export async function DELETE(
  _request: Request,
  context: { params: Promise<{ promotionId: string }> },
): Promise<Response> {
  const { promotionId } = await context.params;
  if (!promotionId.trim()) {
    return Response.json(
      { error: "Promotion id is required" },
      { status: 400, headers: { "Cache-Control": "private, no-store" } },
    );
  }
  return proxyAdminPayments(
    `/admin/catalog/promotions/${encodeURIComponent(promotionId)}`,
    false,
    "DELETE",
  );
}
