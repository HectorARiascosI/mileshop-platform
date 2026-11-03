import { proxyAdminPayments } from "@/lib/admin-payments-proxy";

export async function GET(): Promise<Response> {
  return proxyAdminPayments("/admin/catalog/announcements");
}

export async function POST(request: Request): Promise<Response> {
  return proxyAdminPayments(
    "/admin/catalog/announcements",
    false,
    "POST",
    await request.text(),
  );
}
