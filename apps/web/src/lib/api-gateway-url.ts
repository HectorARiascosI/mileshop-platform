type ApiGatewayUrlOptions = {
  gatewayUrl?: string;
  isProduction?: boolean;
};

export function getApiGatewayEndpoint(
  path: string,
  options: ApiGatewayUrlOptions = {},
): URL | null {
  const gatewayUrl = options.gatewayUrl ?? process.env.API_GATEWAY_URL;
  const isProduction = options.isProduction ?? process.env.NODE_ENV === "production";

  const pathSegments = path.startsWith("/") ? path.slice(1).split("/") : [];
  if (
    !gatewayUrl?.trim() ||
    !path.startsWith("/") ||
    path.startsWith("//") ||
    path.includes("?") ||
    path.includes("#") ||
    path.includes("\\") ||
    pathSegments.some((segment) => segment === "." || segment === "..")
  ) {
    return null;
  }

  try {
    const baseUrl = new URL(gatewayUrl.trim());
    if (
      !["http:", "https:"].includes(baseUrl.protocol) ||
      baseUrl.username ||
      baseUrl.password ||
      baseUrl.search ||
      baseUrl.hash ||
      (isProduction && baseUrl.protocol !== "https:")
    ) {
      return null;
    }

    baseUrl.pathname = `${baseUrl.pathname.replace(/\/+$/, "")}/`;
    return new URL(path.slice(1), baseUrl);
  } catch {
    return null;
  }
}
