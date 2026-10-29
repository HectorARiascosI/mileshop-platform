import { cookies } from "next/headers";

export async function POST() {
  const cookieStore = await cookies();
  const refreshToken = cookieStore.get("refreshToken")?.value;

  const gatewayUrl = process.env.API_GATEWAY_URL ?? "http://localhost:3000";

  try {
    await fetch(`${gatewayUrl}/auth/logout`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ refreshToken }),
    });
  } catch {
    // Best-effort: proceed to delete cookies even if the gateway call fails
  }

  cookieStore.delete("accessToken");
  cookieStore.delete("refreshToken");

  return new Response(null, { status: 204 });
}
