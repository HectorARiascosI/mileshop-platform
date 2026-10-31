import { proxyAdminPayments } from "@/lib/admin-payments-proxy";

export async function GET(): Promise<Response> {
  return proxyAdminPayments("/admin/cancellation-requests");
}
