import assert from "node:assert/strict";
import test from "node:test";

import { getOptimizedImageUrl } from "./imagekit-url";

test("adds responsive delivery transformations to ImageKit images", () => {
  const result = new URL(
    getOptimizedImageUrl("https://ik.imagekit.io/store/products/item.jpg", 800),
  );
  assert.equal(result.searchParams.get("tr"), "w-800,q-85,f-auto");
});

test("leaves external URLs and invalid widths unchanged", () => {
  const externalUrl = "https://images.example.com/item.jpg";
  assert.equal(getOptimizedImageUrl(externalUrl, 400), externalUrl);
  assert.equal(
    getOptimizedImageUrl("https://ik.imagekit.io/store/item.jpg", 0),
    "https://ik.imagekit.io/store/item.jpg",
  );
});
