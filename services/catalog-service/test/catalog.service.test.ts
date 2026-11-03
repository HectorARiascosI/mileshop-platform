import assert from "node:assert/strict";
import test from "node:test";

import { CatalogService, InMemoryCatalogStore } from "../src/catalog.service.js";

test("catalog starts with the seeded active product catalog", async () => {
  const catalog = new CatalogService(new InMemoryCatalogStore());
  const products = await catalog.listProducts();

  assert.equal(products.length, 3);
  assert.deepEqual(products[0], {
    id: "prod-bag-001",
    sku: "MILE-BAG-001",
    name: "Bolso de lona",
    description: "Ligero, resistente y listo para acompañarte.",
    priceCop: 76000,
    stock: 12,
  });

  assert.deepEqual(products.at(-1), {
    id: "prod-mug-001",
    sku: "MILE-MUG-001",
    name: "Taza de cerámica",
    description: "Una taza sencilla para empezar bien el día.",
    priceCop: 28000,
    stock: 24,
  });
});

test("admin can manage products and receive stock with an auditable idempotent receipt", async () => {
  const service = new CatalogService(new InMemoryCatalogStore([]));
  const product = await service.createProduct({
    sku: "NEW-ITEM-01",
    name: "Nuevo artículo",
    description: "Descripción",
    priceCop: 12500,
    imageUrl: "https://ik.imagekit.io/store/products/item.jpg",
    imageFileId: "image-file-01",
    isActive: true,
  });

  assert.equal(product.stock, 0);
  assert.equal(product.imageUrl, "https://ik.imagekit.io/store/products/item.jpg");
  assert.equal(product.imageFileId, "image-file-01");
  assert.equal("imageFileId" in (await service.listProducts())[0]!, false);
  assert.equal((await service.listAdminProducts())[0]?.imageFileId, "image-file-01");
  const legacyUpdate = await service.updateProduct(product.id, {
    sku: product.sku,
    name: product.name,
    description: "Descripción actualizada",
    priceCop: product.priceCop,
    imageUrl: product.imageUrl ?? null,
    isActive: true,
  });
  assert.equal(legacyUpdate.imageFileId, "image-file-01");
  const lines = [{ productId: product.id, quantity: 8 }];
  const first = await service.receiveStock("admin-1", "receipt-1", "Compra al proveedor", lines);
  const replay = await service.receiveStock("admin-1", "receipt-1", "Compra al proveedor", lines);

  assert.deepEqual(replay, first);
  assert.equal((await service.listProducts())[0]?.stock, 8);
  assert.equal((await service.listAdminProducts())[0]?.isActive, true);
  await assert.rejects(
    () => service.receiveStock("admin-1", "receipt-1", "Ajuste distinto", lines),
    { code: "CONFLICT" },
  );
  await assert.rejects(
    () => service.createProduct({
      sku: "new-item-01",
      name: "SKU duplicado",
      description: "",
      priceCop: 0,
      imageUrl: null,
      isActive: true,
    }),
    { code: "CONFLICT" },
  );
});

test("managed image references require a URL and a safe file id", async () => {
  const service = new CatalogService(new InMemoryCatalogStore([]));
  const baseInput = {
    sku: "IMAGE-REF-01",
    name: "Producto con foto",
    description: "",
    priceCop: 100,
    isActive: true,
  };

  await assert.rejects(
    () => service.createProduct({
      ...baseInput,
      imageUrl: null,
      imageFileId: "file-1",
    }),
    { code: "INVALID_COMMAND" },
  );
  await assert.rejects(
    () => service.createProduct({
      ...baseInput,
      imageUrl: "https://ik.imagekit.io/store/products/item.jpg",
      imageFileId: "../other-file",
    }),
    { code: "INVALID_COMMAND" },
  );
  await assert.rejects(
    () => service.createProduct({
      ...baseInput,
      imageUrl: "https://images.example.com/item.jpg",
      imageFileId: "file-1",
    }),
    { code: "INVALID_COMMAND" },
  );
});

test("admin manages predefined category themes and protects categories assigned to products", async () => {
  const service = new CatalogService(new InMemoryCatalogStore([]));
  const category = await service.createCategory({
    name: "Accesorios para moto",
    theme: "blue",
  });
  assert.equal(category.slug, "accesorios-para-moto");
  assert.equal(category.productCount, 0);

  const product = await service.createProduct({
    sku: "CATEGORY-01",
    name: "Pitillos para moto",
    description: "Accesorios para ruedas",
    priceCop: 10000,
    imageUrl: null,
    categoryId: category.id,
    isActive: true,
  });
  assert.equal(product.category?.id, category.id);
  assert.equal(product.category?.theme, "blue");
  assert.equal((await service.listCategories())[0]?.productCount, 1);
  assert.equal((await service.listProducts())[0]?.category?.name, "Accesorios para moto");

  await assert.rejects(
    () => service.deleteCategory(category.id),
    { code: "CONFLICT" },
  );
  await assert.rejects(
    () => service.createCategory({ name: "ACCESORIOS-PARA-MOTO", theme: "gold" }),
    { code: "CONFLICT" },
  );

  const updatedCategory = await service.updateCategory(category.id, {
    name: "Accesorios de moto",
    theme: "gold",
  });
  assert.equal(updatedCategory.slug, "accesorios-de-moto");
  assert.equal((await service.listProducts())[0]?.category?.theme, "gold");

  await service.updateProduct(product.id, {
    sku: product.sku,
    name: product.name,
    description: product.description,
    priceCop: product.priceCop,
    imageUrl: null,
    isActive: true,
  });
  assert.equal((await service.listProducts())[0]?.category?.id, category.id);

  await service.updateProduct(product.id, {
    sku: product.sku,
    name: product.name,
    description: product.description,
    priceCop: product.priceCop,
    imageUrl: null,
    categoryId: null,
    isActive: true,
  });
  assert.equal((await service.listProducts())[0]?.category, undefined);
  assert.equal((await service.listCategories())[0]?.productCount, 0);
  await service.deleteCategory(category.id);
  assert.deepEqual(await service.listCategories(), []);
});

test("admin can soft-disable a product without deleting its inventory history", async () => {
  const service = new CatalogService(new InMemoryCatalogStore([]));
  const product = await service.createProduct({
    sku: "DISABLE-01",
    name: "Producto desactivable",
    description: "",
    priceCop: 100,
    imageUrl: null,
    isActive: true,
  });
  await service.receiveStock("admin-1", "receipt-disable", "Compra inicial", [
    { productId: product.id, quantity: 2 },
  ]);
  const deactivated = await service.updateProduct(product.id, {
    sku: product.sku,
    name: product.name,
    description: product.description,
    priceCop: product.priceCop,
    imageUrl: null,
    isActive: false,
  });

  assert.equal(deactivated.stock, 2);
  assert.deepEqual(await service.listProducts(), []);
  assert.equal((await service.listAdminProducts())[0]?.isActive, false);
  await assert.rejects(
    () => service.recordManualSale("admin-1", "sale-disabled", [
      { productId: product.id, quantity: 1 },
    ]),
    { code: "INSUFFICIENT_INVENTORY" },
  );
});

test("manual sales atomically reduce stock and replay idempotently", async () => {
  const service = createInventoryService(3);
  const lines = [{ productId: "product-1", quantity: 2 }];

  const first = await service.recordManualSale("admin-1", "sale-key-1", lines);
  const replay = await service.recordManualSale("admin-1", "sale-key-1", lines);

  assert.deepEqual(replay, first);
  assert.equal(first.lines[0]?.quantity, 2);
  assert.equal((await service.listProducts()).find((product) => product.id === "product-1")?.stock, 1);
  await assert.rejects(
    () => service.recordManualSale("admin-1", "sale-key-1", [
      { productId: "product-1", quantity: 1 },
    ]),
    { code: "CONFLICT" },
  );
  await assert.rejects(
    () => service.recordManualSale("admin-1", "sale-key-2", [
      { productId: "product-1", quantity: 2 },
    ]),
    { code: "INSUFFICIENT_INVENTORY" },
  );
});

function createInventoryService(stock = 1): CatalogService {
  return new CatalogService(new InMemoryCatalogStore([
    {
      id: "product-1",
      sku: "SKU-1",
      name: "Product 1",
      description: "",
      priceCop: 100,
      stock,
    },
    {
      id: "product-2",
      sku: "SKU-2",
      name: "Product 2",
      description: "",
      priceCop: 100,
      stock,
    },
  ]));
}

const futureExpiry = (): Date => new Date(Date.now() + 60_000);

test("reserves all lines and treats an identical order retry as idempotent", async () => {
  const service = createInventoryService(2);
  const lines = [
    { productId: "product-1", quantity: 1 },
    { productId: "product-2", quantity: 1 },
  ];

  const first = await service.reserveInventory("order-1", lines, futureExpiry());
  const replay = await service.reserveInventory("order-1", [...lines].reverse(), futureExpiry());

  assert.equal(first.status, "ACTIVE");
  assert.deepEqual(replay, first);
  assert.equal((await service.listProducts())[0]?.stock, 1);
  assert.equal((await service.listProducts())[1]?.stock, 1);
  await assert.rejects(
    () => service.reserveInventory(
      "order-1",
      [{ productId: "product-1", quantity: 2 }],
      futureExpiry(),
    ),
    { code: "CONFLICT" },
  );
});

test("available stock returns on release but remains reduced after commit", async () => {
  const service = createInventoryService(3);

  assert.equal((await service.listProducts())[0]?.stock, 3);
  await service.reserveInventory(
    "order-release",
    [{ productId: "product-1", quantity: 2 }],
    futureExpiry(),
  );
  assert.equal((await service.listProducts())[0]?.stock, 1);
  await service.releaseInventory("order-release");
  assert.equal((await service.listProducts())[0]?.stock, 3);

  await service.reserveInventory(
    "order-commit",
    [{ productId: "product-1", quantity: 2 }],
    futureExpiry(),
  );
  await service.commitInventory("order-commit");
  assert.equal((await service.listProducts())[0]?.stock, 1);
});

test("does not leave a partial reservation when any line is unavailable", async () => {
  const service = createInventoryService(1);

  await assert.rejects(
    () => service.reserveInventory("order-fails", [
      { productId: "product-1", quantity: 1 },
      { productId: "product-2", quantity: 2 },
    ], futureExpiry()),
    { code: "INSUFFICIENT_INVENTORY" },
  );

  const nextOrder = await service.reserveInventory(
    "order-next",
    [{ productId: "product-1", quantity: 1 }],
    futureExpiry(),
  );
  assert.equal(nextOrder.status, "ACTIVE");
});

test("allows only one concurrent reservation for the last unit", async () => {
  const service = createInventoryService(1);
  const results = await Promise.allSettled([
    service.reserveInventory(
      "order-a",
      [{ productId: "product-1", quantity: 1 }],
      futureExpiry(),
    ),
    service.reserveInventory(
      "order-b",
      [{ productId: "product-1", quantity: 1 }],
      futureExpiry(),
    ),
  ]);

  assert.equal(results.filter((result) => result.status === "fulfilled").length, 1);
  assert.equal(
    results.filter((result) => result.status === "rejected").length,
    1,
  );
});

test("commit reduces physical and reserved stock once", async () => {
  const service = createInventoryService(2);
  await service.reserveInventory(
    "order-commit",
    [{ productId: "product-1", quantity: 2 }],
    futureExpiry(),
  );

  const committed = await service.commitInventory("order-commit");
  const replay = await service.commitInventory("order-commit");

  assert.equal(committed.status, "COMMITTED");
  assert.deepEqual(replay, committed);
  await assert.rejects(
    () => service.reserveInventory(
      "order-after-sale",
      [{ productId: "product-1", quantity: 1 }],
      futureExpiry(),
    ),
    { code: "INSUFFICIENT_INVENTORY" },
  );
});

test("release restores reserved stock once and cannot release a committed sale", async () => {
  const service = createInventoryService(1);
  await service.reserveInventory(
    "order-release",
    [{ productId: "product-1", quantity: 1 }],
    futureExpiry(),
  );

  assert.equal((await service.releaseInventory("order-release")).status, "RELEASED");
  assert.equal((await service.releaseInventory("order-release")).status, "RELEASED");
  await service.reserveInventory(
    "order-next",
    [{ productId: "product-1", quantity: 1 }],
    futureExpiry(),
  );
  await service.commitInventory("order-next");
  await assert.rejects(
    () => service.releaseInventory("order-next"),
    { code: "CONFLICT" },
  );
});

test("rejects expired reservations and invalid quantities", async () => {
  const service = createInventoryService(2);

  await assert.rejects(
    () => service.reserveInventory(
      "order-expired",
      [{ productId: "product-1", quantity: 1 }],
      new Date(Date.now() - 1),
    ),
    { code: "INVALID_COMMAND" },
  );
  await assert.rejects(
    () => service.reserveInventory(
      "order-invalid",
      [{ productId: "product-1", quantity: 0 }],
      futureExpiry(),
    ),
    { code: "INVALID_COMMAND" },
  );
});
