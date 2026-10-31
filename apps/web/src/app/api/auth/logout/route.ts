import { cookies } from "next/headers";

import { getApiGatewayEndpoint } from "@/lib/api-gateway-url";
import { clearSessionCookies } from "@/lib/auth-session";

export async function POST() {
  const cookieStore = await cookies();
  const refreshToken = cookieStore.get("refreshToken")?.value;

  const endpoint = getApiGatewayEndpoint("/auth/logout");

  if (endpoint) {
    try {
      await fetch(endpoint, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ refreshToken }),
      });
    } catch {
      // Best-effort: proceed to delete cookies even if the gateway call fails.
    }
  }

  await clearSessionCookies();

  return new Response(null, { status: 204 });
}
