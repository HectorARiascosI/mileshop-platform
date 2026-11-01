import assert from "node:assert/strict";
import test from "node:test";

import { createPreviewProtectedFetch } from "../src/preview-protected-fetch.js";

test("adds a destination-specific bypass header to Vercel Preview requests", async () => {
  let requestHeaders: Headers | undefined;
  const fetcher = createPreviewProtectedFetch(
    "catalog-bypass-secret",
    async (_input, init) => {
      requestHeaders = new Headers(init?.headers);
      return new Response(null, { status: 200 });
    },
    "preview",
  );

  await fetcher(
    "https://catalog-preview-hector-riascos-projects.vercel.app/api/internal/reservations",
    {
      method: "POST",
      headers: { "content-type": "application/json" },
    },
  );

  assert.equal(requestHeaders?.get("x-vercel-protection-bypass"), "catalog-bypass-secret");
  assert.equal(requestHeaders?.get("content-type"), "application/json");
});

test("does not send bypass secrets to non-Vercel or non-Preview requests", async () => {
  const headers: Headers[] = [];
  const fetcher = (vercelEnv: string | undefined) => createPreviewProtectedFetch(
    "preview-bypass-secret",
    async (_input, init) => {
      headers.push(new Headers(init?.headers));
      return new Response(null, { status: 200 });
    },
    vercelEnv,
  );

  await fetcher("preview")("https://orders.example.com/api");
  await fetcher("preview")("https://other-team-project.vercel.app/api");
  await fetcher("production")("https://catalog-preview.vercel.app/api");

  assert.ok(headers.every((requestHeaders) => !requestHeaders.has("x-vercel-protection-bypass")));
});
