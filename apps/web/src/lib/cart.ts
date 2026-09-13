export type CartLine = {
  productId: string;
  sku: string;
  name: string;
  priceCop: number;
  quantity: number;
};

export function addProductToCart(currentCart: CartLine[], product: CartLine): CartLine[] {
  const normalizedProduct = {
    ...product,
    quantity: Math.max(1, product.quantity),
  };

  const existing = currentCart.find((item) => item.productId === normalizedProduct.productId);

  if (!existing) {
    return [...currentCart, normalizedProduct];
  }

  return currentCart.map((item) =>
    item.productId === normalizedProduct.productId
      ? { ...item, quantity: item.quantity + normalizedProduct.quantity }
      : item,
  );
}

export function updateProductQuantity(currentCart: CartLine[], productId: string, quantity: number): CartLine[] {
  const safeQuantity = Math.max(0, quantity);

  return currentCart
    .map((item) =>
      item.productId === productId ? { ...item, quantity: safeQuantity } : item,
    )
    .filter((item) => item.quantity > 0);
}

export function removeProductFromCart(currentCart: CartLine[], productId: string): CartLine[] {
  return currentCart.filter((item) => item.productId !== productId);
}

export function getCartItemCount(currentCart: CartLine[]): number {
  return currentCart.reduce((total, item) => total + item.quantity, 0);
}

export function getCartSubtotal(currentCart: CartLine[]): number {
  return currentCart.reduce((total, item) => total + item.priceCop * item.quantity, 0);
}
