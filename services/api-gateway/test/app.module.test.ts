import assert from "node:assert/strict";
import test from "node:test";
import { RequestMethod } from "@nestjs/common";

import { AUTHENTICATED_ROUTES } from "../src/app.module.js";

test("authenticates all catalog administration routes", () => {
  const expectedRoutes = [
    { path: "admin/catalog/products", method: RequestMethod.GET },
    { path: "admin/catalog/products", method: RequestMethod.POST },
    { path: "admin/catalog/products/:productId", method: RequestMethod.PATCH },
    { path: "admin/catalog/categories", method: RequestMethod.GET },
    { path: "admin/catalog/categories", method: RequestMethod.POST },
    { path: "admin/catalog/categories/:categoryId", method: RequestMethod.PATCH },
    { path: "admin/catalog/categories/:categoryId", method: RequestMethod.DELETE },
    { path: "admin/catalog/stock-receipts", method: RequestMethod.POST },
  ];

  for (const expected of expectedRoutes) {
    assert.ok(
      AUTHENTICATED_ROUTES.some(
        (route) => route.path === expected.path && route.method === expected.method,
      ),
      `Missing authentication middleware for ${expected.method} ${expected.path}`,
    );
  }
});
