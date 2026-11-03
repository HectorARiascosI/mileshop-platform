import { proxyAdminPayments } from "@/lib/admin-payments-proxy";

export async function GET(): Promise<Response> {
  return proxyAdminPayments("/admin/catalog/promotions");
}

export async function POST(request: Request): Promise<Response> {
  return proxyAdminPayments(
    "/admin/catalog/promotions",
    false,
    "POST",
    await request.text(),
  );
}
