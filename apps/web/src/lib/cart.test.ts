import assert from "node:assert/strict";
import test from "node:test";

import {
  addProductToCart,
  getCartItemCount,
  getCartSubtotal,
  removeProductFromCart,
  updateProductQuantity,
} from "./cart";

test("agrega un producto al carrito y acumula cantidad", () => {
  const cart = addProductToCart(
    [
      {
        productId: "p-1",
        sku: "SKU-01",
        name: "Botella térmica",
        priceCop: 65000,
        quantity: 1,
      },
    ],
    {
      productId: "p-1",
      sku: "SKU-01",
      name: "Botella térmica",
      priceCop: 65000,
      quantity: 2,
    },
  );

  assert.equal(cart.length, 1);
  assert.equal(cart[0]?.quantity, 3);
  assert.equal(getCartItemCount(cart), 3);
  assert.equal(getCartSubtotal(cart), 195000);
});

test("actualiza la cantidad y elimina un producto", () => {
  let cart = addProductToCart([], {
    productId: "p-2",
    sku: "SKU-02",
    name: "Pañal premium",
    priceCop: 42000,
    quantity: 1,
  });

  cart = updateProductQuantity(cart, "p-2", 4);
  assert.equal(cart[0]?.quantity, 4);

  cart = removeProductFromCart(cart, "p-2");
  assert.deepEqual(cart, []);
});
