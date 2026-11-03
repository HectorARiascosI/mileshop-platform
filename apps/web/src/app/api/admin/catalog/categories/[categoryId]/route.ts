import { proxyAdminPayments } from "@/lib/admin-payments-proxy";

export async function PATCH(
  request: Request,
  context: { params: Promise<{ categoryId: string }> },
): Promise<Response> {
  const { categoryId } = await context.params;
  if (!categoryId.trim()) {
    return Response.json(
      { error: "Category id is required" },
      { status: 400, headers: { "Cache-Control": "private, no-store" } },
    );
  }
  return proxyAdminPayments(
    `/admin/catalog/categories/${encodeURIComponent(categoryId)}`,
    false,
    "PATCH",
    await request.text(),
  );
}

export async function DELETE(
  _request: Request,
  context: { params: Promise<{ categoryId: string }> },
): Promise<Response> {
  const { categoryId } = await context.params;
  if (!categoryId.trim()) {
    return Response.json(
      { error: "Category id is required" },
      { status: 400, headers: { "Cache-Control": "private, no-store" } },
    );
  }
  return proxyAdminPayments(
    `/admin/catalog/categories/${encodeURIComponent(categoryId)}`,
    false,
    "DELETE",
  );
}
