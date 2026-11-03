function getTargetUrl(input: RequestInfo | URL): URL | undefined {
  try {
    return new URL(input instanceof Request ? input.url : input);
  } catch (error) {
    if (error instanceof TypeError) {
      return undefined;
    }
    throw error;
  }
}

export function createPreviewProtectedFetch(
  bypassSecret: string | undefined,
  fetcher: typeof fetch = fetch,
  vercelEnv: string | undefined = process.env.VERCEL_ENV,
): typeof fetch {
  const secret = bypassSecret?.trim();

  return (input, init) => {
    const targetUrl = getTargetUrl(input);
    if (
      vercelEnv !== "preview" ||
      !secret ||
      targetUrl?.protocol !== "https:" ||
      !targetUrl.hostname.endsWith("-hector-riascos-projects.vercel.app")
    ) {
      return fetcher(input, init);
    }

    const headers = new Headers(input instanceof Request ? input.headers : undefined);
    new Headers(init?.headers).forEach((value, key) => headers.set(key, value));
    headers.set("x-vercel-protection-bypass", secret);

    return fetcher(input, { ...init, headers });
  };
}
