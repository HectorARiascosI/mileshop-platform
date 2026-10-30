import { refreshSession } from "@/lib/auth-session";

export async function POST() {
  const gatewayUrl = process.env.API_GATEWAY_URL ?? "http://localhost:3000";
  const result = await refreshSession(gatewayUrl);

  if (result === "refreshed") {
    return Response.json({ ok: true });
  }
  if (result === "unauthenticated") {
    return Response.json({ error: "Session expired" }, { status: 401 });
  }

  return Response.json({ error: "Identity service unavailable" }, { status: 503 });
}
