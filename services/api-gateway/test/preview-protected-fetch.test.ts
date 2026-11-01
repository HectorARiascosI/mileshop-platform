import assert from "node:assert/strict";
import test from "node:test";

import { createPreviewProtectedFetch } from "../src/preview-protected-fetch.js";

test("adds the target deployment bypass only for HTTPS team Vercel Preview requests", async () => {
  let requestHeaders: Headers | undefined;
  const fetcher = createPreviewProtectedFetch(
    "  preview-bypass-secret  ",
    async (_input, init) => {
      requestHeaders = new Headers(init?.headers);
      return new Response(null, { status: 200 });
    },
    "preview",
  );

  await fetcher("https://catalog-preview-hector-riascos-projects.vercel.app/api/products", {
    headers: { accept: "application/json" },
  });

  assert.equal(requestHeaders?.get("x-vercel-protection-bypass"), "preview-bypass-secret");
  assert.equal(requestHeaders?.get("accept"), "application/json");
});

test("does not send the bypass to Production, local, or non-Vercel destinations", async () => {
  const requests: Array<{ url: string; headers: Headers }> = [];
  const fetcher = createPreviewProtectedFetch(
    "preview-bypass-secret",
    async (input, init) => {
      requests.push({
        url: input instanceof Request ? input.url : String(input),
        headers: new Headers(init?.headers),
      });
      return new Response(null, { status: 200 });
    },
    "preview",
  );

  await fetcher("https://service.example.com/api");
  await fetcher("https://other-team-project.vercel.app/api");
  await fetcher("http://localhost:3000/api");
  await createPreviewProtectedFetch(
    "preview-bypass-secret",
    async (input, init) => {
      requests.push({
        url: input instanceof Request ? input.url : String(input),
        headers: new Headers(init?.headers),
      });
      return new Response(null, { status: 200 });
    },
    "production",
  )("https://catalog-preview.vercel.app/api");

  assert.equal(requests.length, 4);
  assert.ok(requests.every(({ headers }) => !headers.has("x-vercel-protection-bypass")));
});
