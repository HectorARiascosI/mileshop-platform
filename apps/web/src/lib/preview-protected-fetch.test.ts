import assert from "node:assert/strict";
import test from "node:test";

import { createPreviewProtectedFetch } from "./preview-protected-fetch";

test("adds the Gateway bypass header only to HTTPS team Vercel Preview requests", async () => {
  let requestHeaders: Headers | undefined;
  const fetcher = createPreviewProtectedFetch(
    "gateway-bypass-secret",
    async (_input, init) => {
      requestHeaders = new Headers(init?.headers);
      return new Response(null, { status: 200 });
    },
    "preview",
  );

  await fetcher(
    "https://gateway-preview-hector-riascos-projects.vercel.app/api/catalog/products",
    {
      headers: { accept: "application/json" },
    },
  );

  assert.equal(requestHeaders?.get("x-vercel-protection-bypass"), "gateway-bypass-secret");
  assert.equal(requestHeaders?.get("accept"), "application/json");
});

test("does not send the bypass to non-Vercel or non-Preview requests", async () => {
  const headers: Headers[] = [];
  const createFetcher = (vercelEnv: string | undefined) => createPreviewProtectedFetch(
    "gateway-bypass-secret",
    async (_input, init) => {
      headers.push(new Headers(init?.headers));
      return new Response(null, { status: 200 });
    },
    vercelEnv,
  );

  await createFetcher("preview")("https://gateway.example.com/api");
  await createFetcher("preview")("https://other-team-project.vercel.app/api");
  await createFetcher("production")("https://gateway-preview.vercel.app/api");

  assert.ok(headers.every((requestHeaders) => !requestHeaders.has("x-vercel-protection-bypass")));
});
