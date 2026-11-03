import assert from "node:assert/strict";
import test from "node:test";
import { Module } from "@nestjs/common";
import { NestFactory } from "@nestjs/core";
import { FastifyAdapter } from "@nestjs/platform-fastify";

import { CatalogController } from "../src/catalog.controller.js";
import { CatalogService, InMemoryCatalogStore } from "../src/catalog.service.js";
import { InventoryCommandGuard } from "../src/inventory-command.guard.js";

function createCatalogApp(catalog: CatalogService) {
  class CatalogHttpTestModule {}
  Module({
    controllers: [CatalogController],
    providers: [
      { provide: "CATALOG_SERVICE", useValue: catalog },
      InventoryCommandGuard,
    ],
  })(CatalogHttpTestModule);
  return NestFactory.create(
    CatalogHttpTestModule,
    new FastifyAdapter(),
    { logger: false },
  );
}

test("GET /products returns available stock without changing its response shape", async () => {
  const catalog = new CatalogService(new InMemoryCatalogStore([{
    id: "product-1",
    sku: "SKU-1",
    name: "Product 1",
    description: "",
    priceCop: 100,
    stock: 3,
  }]));
  await catalog.reserveInventory(
    "order-1",
    [{ productId: "product-1", quantity: 2 }],
    new Date(Date.now() + 60_000),
  );
  const app = await createCatalogApp(catalog);
  await app.listen(0, "127.0.0.1");
  try {
    const response = await fetch(`${await app.getUrl()}/products`);

    assert.equal(response.status, 200);
    const payload: unknown = await response.json();
    assert.ok(payload !== null && typeof payload === "object" && "data" in payload);
    assert.ok(Array.isArray(payload.data));
    assert.deepEqual(payload.data[0], {
      id: "product-1",
      sku: "SKU-1",
      name: "Product 1",
      description: "",
      priceCop: 100,
      stock: 1,
    });
  } finally {
    await app.close();
  }
});

test("manual-sale endpoint uses internal authentication and preserves idempotency", async () => {
  const token = "catalog-inventory-token-for-tests-0123456789";
  const previousToken = process.env.CATALOG_INVENTORY_COMMAND_TOKEN;
  process.env.CATALOG_INVENTORY_COMMAND_TOKEN = token;
  const catalog = new CatalogService(new InMemoryCatalogStore([{
    id: "product-1",
    sku: "SKU-1",
    name: "Product 1",
    description: "",
    priceCop: 100,
    stock: 3,
  }]));
  const app = await createCatalogApp(catalog);
  await app.listen(0, "127.0.0.1");
  try {
    const url = `${await app.getUrl()}/internal/admin/manual-sales`;
    const headers = {
      authorization: `Bearer ${token}`,
      "content-type": "application/json",
      "idempotency-key": "manual-sale-1",
    };
    const requestBody = JSON.stringify({
      adminCustomerId: "admin-1",
      lines: [{ productId: "product-1", quantity: 2 }],
    });
    const first = await fetch(url, { method: "POST", headers, body: requestBody });
    const firstPayload = await first.json();
    const replay = await fetch(url, { method: "POST", headers, body: requestBody });

    assert.equal(first.status, 200);
    assert.deepEqual(await replay.json(), firstPayload);
    assert.equal((await catalog.listProducts())[0]?.stock, 1);

    const unauthorized = await fetch(url, {
      method: "POST",
      headers: { ...headers, authorization: "Bearer invalid" },
      body: requestBody,
    });
    assert.equal(unauthorized.status, 401);
  } finally {
    await app.close();
    if (previousToken === undefined) delete process.env.CATALOG_INVENTORY_COMMAND_TOKEN;
    else process.env.CATALOG_INVENTORY_COMMAND_TOKEN = previousToken;
  }
});

test("admin product and stock receipt endpoints require internal auth and persist changes", async () => {
  const token = "catalog-inventory-token-for-tests-0123456789";
  const previousToken = process.env.CATALOG_INVENTORY_COMMAND_TOKEN;
  process.env.CATALOG_INVENTORY_COMMAND_TOKEN = token;
  const catalog = new CatalogService(new InMemoryCatalogStore([]));
  const app = await createCatalogApp(catalog);
  await app.listen(0, "127.0.0.1");
  try {
    const baseUrl = await app.getUrl();
    const headers = {
      authorization: `Bearer ${token}`,
      "content-type": "application/json",
    };
    const productResponse = await fetch(`${baseUrl}/internal/admin/products`, {
      method: "POST",
      headers,
      body: JSON.stringify({
        sku: "HTTP-PRODUCT-01",
        name: "Producto por HTTP",
        description: "",
        priceCop: 5000,
        imageUrl: "https://ik.imagekit.io/store/products/product-1.jpg",
        imageFileId: "image-file-01",
        images: [
          {
            imageUrl: "https://ik.imagekit.io/store/products/product-1.jpg",
            imageFileId: "image-file-01",
          },
          {
            imageUrl: "https://images.example.com/products/product-1-side.jpg",
            imageFileId: null,
          },
        ],
        isActive: true,
      }),
    });

    await test("category administration is authenticated and cannot delete an assigned category", async () => {
      const token = "catalog-inventory-token-for-tests-0123456789";
      const previousToken = process.env.CATALOG_INVENTORY_COMMAND_TOKEN;
      process.env.CATALOG_INVENTORY_COMMAND_TOKEN = token;
      const catalog = new CatalogService(new InMemoryCatalogStore([]));
      const app = await createCatalogApp(catalog);
      await app.listen(0, "127.0.0.1");
      try {
        const baseUrl = await app.getUrl();
        const url = `${baseUrl}/internal/admin/categories`;
        const headers = {
          authorization: `Bearer ${token}`,
          "content-type": "application/json",
        };
        const unauthorized = await fetch(url);
        assert.equal(unauthorized.status, 401);

        const created = await fetch(url, {
          method: "POST",
          headers,
          body: JSON.stringify({ name: "Accesorios para moto", theme: "blue" }),
        });
        assert.equal(created.status, 201);
        const category = (await created.json()).data;
        assert.equal(category.slug, "accesorios-para-moto");
        assert.equal(category.theme, "blue");

        const productResponse = await fetch(`${baseUrl}/internal/admin/products`, {
          method: "POST",
          headers,
          body: JSON.stringify({
            sku: "HTTP-CATEGORY-01",
            name: "Producto por categoría",
            description: "",
            priceCop: 5000,
            imageUrl: null,
            categoryId: category.id,
            isActive: true,
          }),
        });
        assert.equal(productResponse.status, 201);
        const product = (await productResponse.json()).data;
        assert.equal(product.category.name, "Accesorios para moto");

        const blockedDelete = await fetch(`${url}/${encodeURIComponent(category.id)}`, {
          method: "DELETE",
          headers: { authorization: headers.authorization },
        });
        assert.equal(blockedDelete.status, 409, JSON.stringify(await blockedDelete.json()));

        const categoryList = await fetch(url, { headers });
        const categoryPayload = await categoryList.json();
        assert.equal(categoryPayload.data[0].productCount, 1);
        const renamed = await fetch(`${url}/${encodeURIComponent(category.id)}`, {
          method: "PATCH",
          headers,
          body: JSON.stringify({ name: "Accesorios de moto", theme: "gold" }),
        });
        assert.equal(renamed.status, 200);
        assert.equal((await renamed.json()).data.theme, "gold");
      } finally {
        await app.close();
        if (previousToken === undefined) delete process.env.CATALOG_INVENTORY_COMMAND_TOKEN;
        else process.env.CATALOG_INVENTORY_COMMAND_TOKEN = previousToken;
      }
    });

    await test("marketing endpoints authenticate writes and expose only current announcements and sale prices", async () => {
      const token = "catalog-inventory-token-for-tests-0123456789";
      const previousToken = process.env.CATALOG_INVENTORY_COMMAND_TOKEN;
      process.env.CATALOG_INVENTORY_COMMAND_TOKEN = token;
      const catalog = new CatalogService(new InMemoryCatalogStore([{
        id: "marketing-product",
        sku: "MARKETING-01",
        name: "Artículo campaña",
        description: "",
        priceCop: 50000,
        stock: 5,
        isActive: true,
      }]));
      const app = await createCatalogApp(catalog);
      await app.listen(0, "127.0.0.1");
      try {
        const baseUrl = await app.getUrl();
        const headers = {
          authorization: `Bearer ${token}`,
          "content-type": "application/json",
        };
        const unauthorized = await fetch(`${baseUrl}/internal/admin/promotions`);
        assert.equal(unauthorized.status, 401);

        const startsAt = new Date(Date.now() - 60_000).toISOString();
        const endsAt = new Date(Date.now() + 60 * 60_000).toISOString();

        const promotionResponse = await fetch(`${baseUrl}/internal/admin/promotions`, {
          method: "POST",
          headers,
          body: JSON.stringify({
            title: "Campaña HTTP",
            description: "",
            startsAt,
            endsAt,
            isActive: true,
            products: [{ productId: "marketing-product", discountPercent: 20 }],
          }),
        });
        assert.equal(promotionResponse.status, 201);
        const promotion = (await promotionResponse.json()).data;
        assert.equal(promotion.products[0].discountPercent, 20);
        const productsResponse = await fetch(`${baseUrl}/products`);
        const publicProduct = (await productsResponse.json()).data[0];
        assert.equal(publicProduct.priceCop, 40000);
        assert.equal(publicProduct.priceBeforeDiscountCop, 50000);
        assert.equal(publicProduct.promotion.title, "Campaña HTTP");

        const announcementResponse = await fetch(`${baseUrl}/internal/admin/announcements`, {
          method: "POST",
          headers,
          body: JSON.stringify({
            title: "Aviso HTTP",
            message: "Horario extendido este viernes.",
            linkUrl: null,
            linkLabel: null,
            startsAt,
            endsAt,
            isActive: true,
          }),
        });
        assert.equal(announcementResponse.status, 201);
        const announcement = (await announcementResponse.json()).data;
        const publicAnnouncements = await fetch(`${baseUrl}/announcements`);
        assert.equal(publicAnnouncements.status, 200);
        assert.equal((await publicAnnouncements.json()).data[0].id, announcement.id);

        const disabled = await fetch(
          `${baseUrl}/internal/admin/promotions/${encodeURIComponent(promotion.id)}`,
          {
            method: "PATCH",
            headers,
            body: JSON.stringify({
              title: "Campaña HTTP",
              description: "",
              startsAt,
              endsAt,
              isActive: false,
              products: [{ productId: "marketing-product", discountPercent: 20 }],
            }),
          },
        );
        assert.equal(disabled.status, 200);
        const regularPrice = (await (await fetch(`${baseUrl}/products`)).json()).data[0];
        assert.equal(regularPrice.priceCop, 50000);
        assert.equal(regularPrice.promotion, undefined);
      } finally {
        await app.close();
        if (previousToken === undefined) delete process.env.CATALOG_INVENTORY_COMMAND_TOKEN;
        else process.env.CATALOG_INVENTORY_COMMAND_TOKEN = previousToken;
      }
    });
    assert.equal(productResponse.status, 201);
    const productPayload = await productResponse.json();
    const productId = productPayload.data.id as string;
    assert.equal(productPayload.data.imageFileId, "image-file-01");
    assert.deepEqual(productPayload.data.images.map((image: { position: number }) => image.position), [0, 1]);
    const publicProducts = await fetch(`${baseUrl}/products`);
    const publicProduct = (await publicProducts.json()).data[0];
    assert.equal(publicProduct.images.length, 2);
    assert.equal("imageFileId" in publicProduct.images[0], false);

    const receiptUrl = `${baseUrl}/internal/admin/stock-receipts`;
    const receiptHeaders = { ...headers, "idempotency-key": "http-receipt-1" };
    const body = JSON.stringify({
      adminCustomerId: "admin-1",
      reason: "Compra inicial",
      lines: [{ productId, quantity: 4 }],
    });
    const first = await fetch(receiptUrl, { method: "POST", headers: receiptHeaders, body });
    const replay = await fetch(receiptUrl, { method: "POST", headers: receiptHeaders, body });
    assert.equal(first.status, 201);
    assert.deepEqual(await replay.json(), await first.clone().json());
    assert.equal((await catalog.listProducts())[0]?.stock, 4);

    const unauthorized = await fetch(`${baseUrl}/internal/admin/products`);
    assert.equal(unauthorized.status, 401);
  } finally {
    await app.close();
    if (previousToken === undefined) delete process.env.CATALOG_INVENTORY_COMMAND_TOKEN;
    else process.env.CATALOG_INVENTORY_COMMAND_TOKEN = previousToken;
  }
});
