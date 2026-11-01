import { proxyAdminPayments } from "@/lib/admin-payments-proxy";

export async function PATCH(
  request: Request,
  context: { params: Promise<{ productId: string }> },
): Promise<Response> {
  const { productId } = await context.params;
  if (!productId.trim()) {
    return Response.json(
      { error: "Product id is required" },
      { status: 400, headers: { "Cache-Control": "private, no-store" } },
    );
  }
  return proxyAdminPayments(
    `/admin/catalog/products/${encodeURIComponent(productId)}`,
    false,
    "PATCH",
    await request.text(),
  );
}
