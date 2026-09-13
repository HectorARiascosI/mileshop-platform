"use client";

import Link from "next/link";
import { useEffect, useMemo, useState } from "react";

import {
  addProductToCart,
  getCartItemCount,
  getCartSubtotal,
  removeProductFromCart,
  updateProductQuantity,
  type CartLine,
} from "@/lib/cart";
import { buildCheckoutSummary, buildOrderCreatedEvent } from "@/lib/order";

type Product = {
  id: string;
  sku: string;
  name: string;
  description: string;
  priceCop: number;
  stock: number;
};

type CatalogShellProps = {
  products: Product[];
  unavailable: boolean;
};

const STORAGE_KEY = "mileshop-cart-v1";

function formatPrice(priceCop: number): string {
  return new Intl.NumberFormat("es-CO", {
    style: "currency",
    currency: "COP",
    maximumFractionDigits: 0,
  }).format(priceCop);
}

export function CatalogShell({ products, unavailable }: CatalogShellProps) {
  const [cart, setCart] = useState<CartLine[]>([]);
  const [isCartOpen, setIsCartOpen] = useState(false);
  const [orderConfirmed, setOrderConfirmed] = useState(false);

  useEffect(() => {
    const rawCart = window.localStorage.getItem(STORAGE_KEY);

    if (!rawCart) {
      return;
    }

    try {
      const parsed = JSON.parse(rawCart) as CartLine[];
      if (Array.isArray(parsed)) {
        setCart(parsed);
      }
    } catch {
      window.localStorage.removeItem(STORAGE_KEY);
    }
  }, []);

  useEffect(() => {
    window.localStorage.setItem(STORAGE_KEY, JSON.stringify(cart));
  }, [cart]);

  const cartCount = useMemo(() => getCartItemCount(cart), [cart]);
  const subtotal = useMemo(() => getCartSubtotal(cart), [cart]);
  const checkoutSummary = useMemo(() => buildCheckoutSummary(cart), [cart]);

  const handleAddToCart = (product: Product) => {
    setCart((currentCart) =>
      addProductToCart(currentCart, {
        productId: product.id,
        sku: product.sku,
        name: product.name,
        priceCop: product.priceCop,
        quantity: 1,
      }),
    );
    setIsCartOpen(true);
  };

  const increaseQuantity = (productId: string) => {
    setCart((currentCart) => {
      const current = currentCart.find((item) => item.productId === productId);
      if (!current) {
        return currentCart;
      }
      return updateProductQuantity(currentCart, productId, current.quantity + 1);
    });
  };

  const decreaseQuantity = (productId: string) => {
    setCart((currentCart) => {
      const current = currentCart.find((item) => item.productId === productId);
      if (!current) {
        return currentCart;
      }
      return updateProductQuantity(currentCart, productId, current.quantity - 1);
    });
  };

  const removeItem = (productId: string) => {
    setCart((currentCart) => removeProductFromCart(currentCart, productId));
  };

  const handleCheckout = () => {
    if (cart.length === 0) {
      return;
    }

    const order = buildOrderCreatedEvent(cart, "guest-user");
    window.localStorage.setItem("mileshop-last-order-v1", JSON.stringify(order));
    setOrderConfirmed(true);
    setCart([]);
    setIsCartOpen(true);
    window.location.assign("/checkout");
  };

  return (
    <div className="site-shell">
      <header className="topbar">
        <Link className="brand" href="/" aria-label="MileShop inicio">
          <span className="brand-mark">M</span>
          <span>MileShop</span>
        </Link>

        <div className="topbar-meta">
          <span>Compra local, elige con calma</span>
          <button
            className="cart-button"
            type="button"
            aria-label="Ver carrito"
            onClick={() => setIsCartOpen((current) => !current)}
          >
            Carrito <span className="cart-count">{cartCount}</span>
          </button>
        </div>
      </header>

      <main className="catalog-page">
        <section className="intro" aria-labelledby="catalog-title">
          <div>
            <p className="eyebrow">Selección MileShop</p>
            <h1 id="catalog-title">
              Lo que necesitas,
              <br />
              sin complicaciones.
            </h1>
          </div>
          <p className="intro-copy">
            Productos elegidos para resolver lo cotidiano. Explora el catálogo y encuentra tu próximo favorito.
          </p>
        </section>

        {unavailable ? (
          <section className="notice notice-error" role="alert">
            <strong>El catálogo está temporalmente fuera de línea.</strong>
            <span>Estamos intentando reconectar con nuestros productos.</span>
          </section>
        ) : products.length === 0 ? (
          <section className="notice" role="status">
            <strong>Estamos preparando la primera selección.</strong>
            <span>Vuelve pronto para descubrir los productos disponibles.</span>
          </section>
        ) : (
          <section className="product-grid" aria-label="Productos disponibles">
            {products.map((product, index) => (
              <article className="product-card" key={product.id}>
                <div className={`product-art product-art-${index % 4}`} aria-hidden="true">
                  <span>{product.name.slice(0, 1).toUpperCase()}</span>
                </div>

                <div className="product-info">
                  <div className="product-heading">
                    <p className="product-sku">{product.sku}</p>
                    <span className="stock-label">{product.stock} disponibles</span>
                  </div>

                  <h2>{product.name}</h2>
                  <p className="product-description">
                    {product.description || "Una elección práctica para tu día a día."}
                  </p>

                  <div className="product-footer">
                    <strong>{formatPrice(product.priceCop)}</strong>
                    <button className="add-button" type="button" onClick={() => handleAddToCart(product)}>
                      Añadir <span aria-hidden="true">+</span>
                    </button>
                  </div>
                </div>
              </article>
            ))}
          </section>
        )}
      </main>

      <aside className={`cart-panel ${isCartOpen ? "is-open" : ""}`} aria-live="polite">
        <div className="cart-panel-header">
          <div>
            <p className="eyebrow cart-eyebrow">Carrito</p>
            <h2>Tu selección</h2>
          </div>
          <button className="close-cart" type="button" aria-label="Cerrar carrito" onClick={() => setIsCartOpen(false)}>
            Cerrar
          </button>
        </div>

        {cart.length === 0 ? (
          orderConfirmed ? (
            <div className="notice notice-success" role="status">
              <strong>Pedido confirmado.</strong>
              <span>Tu compra quedó registrada en MileShop y ya puedes seguir explorando el catálogo.</span>
            </div>
          ) : (
            <p className="empty-cart">Todavía no has agregado productos.</p>
          )
        ) : (
          <>
            <ul className="cart-items">
              {cart.map((item) => (
                <li key={item.productId} className="cart-item">
                  <div>
                    <strong>{item.name}</strong>
                    <span>{formatPrice(item.priceCop)}</span>
                  </div>

                  <div className="cart-item-actions">
                    <div className="quantity-controls" aria-label={`Cantidad de ${item.name}`}>
                      <button type="button" onClick={() => decreaseQuantity(item.productId)} aria-label={`Disminuir cantidad de ${item.name}`}>
                        −
                      </button>
                      <span>{item.quantity}</span>
                      <button type="button" onClick={() => increaseQuantity(item.productId)} aria-label={`Aumentar cantidad de ${item.name}`}>
                        +
                      </button>
                    </div>

                    <button type="button" className="delete-item" onClick={() => removeItem(item.productId)}>
                      Quitar
                    </button>
                  </div>
                </li>
              ))}
            </ul>

            <div className="checkout-summary" aria-live="polite">
              <div>
                <span>Subtotal</span>
                <strong>{formatPrice(checkoutSummary.subtotalCop)}</strong>
              </div>
              <div>
                <span>Envío</span>
                <strong>{checkoutSummary.isFreeDelivery ? "Gratis" : formatPrice(checkoutSummary.deliveryFeeCop)}</strong>
              </div>
              <div className="checkout-total">
                <span>Total</span>
                <strong>{formatPrice(checkoutSummary.totalCop)}</strong>
              </div>
            </div>

            <button className="checkout-button" type="button" onClick={handleCheckout}>
              Confirmar pedido
            </button>
          </>
        )}
      </aside>

      <footer className="footer">
        <span>MileShop</span>
        <span>Catálogo en evolución</span>
      </footer>
    </div>
  );
}
