import test from "node:test";
import assert from "node:assert/strict";

import { CatalogService, InMemoryCatalogStore } from "../src/catalog.service.js";

test("catalog starts with an empty active product list", async () => {
  const catalog = new CatalogService(new InMemoryCatalogStore());

  assert.deepEqual(await catalog.listProducts(), []);
});
