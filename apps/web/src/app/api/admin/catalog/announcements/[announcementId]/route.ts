import { proxyAdminPayments } from "@/lib/admin-payments-proxy";

export async function PATCH(
  request: Request,
  context: { params: Promise<{ announcementId: string }> },
): Promise<Response> {
  const { announcementId } = await context.params;
  if (!announcementId.trim()) {
    return Response.json(
      { error: "Announcement id is required" },
      { status: 400, headers: { "Cache-Control": "private, no-store" } },
    );
  }
  return proxyAdminPayments(
    `/admin/catalog/announcements/${encodeURIComponent(announcementId)}`,
    false,
    "PATCH",
    await request.text(),
  );
}

export async function DELETE(
  _request: Request,
  context: { params: Promise<{ announcementId: string }> },
): Promise<Response> {
  const { announcementId } = await context.params;
  if (!announcementId.trim()) {
    return Response.json(
      { error: "Announcement id is required" },
      { status: 400, headers: { "Cache-Control": "private, no-store" } },
    );
  }
  return proxyAdminPayments(
    `/admin/catalog/announcements/${encodeURIComponent(announcementId)}`,
    false,
    "DELETE",
  );
}
