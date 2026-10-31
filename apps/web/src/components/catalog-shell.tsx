"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useEffect, useState, useSyncExternalStore } from "react";

import {
  addProductToCart,
  getCartItemCount,
  removeProductFromCart,
  updateProductQuantity,
  type CartLine,
} from "@/lib/cart";
import { buildCheckoutSummary } from "@/lib/order";
import {
  buildWhatsAppOrderUrl,
  normalizeWhatsAppBusinessPhone,
  isWhatsAppOrderSummary,
  type WhatsAppOrderSummary,
} from "@/lib/whatsapp-order";

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
const IDEMPOTENCY_STORAGE_KEY = "mileshop-checkout-idempotency-v1";
const WHATSAPP_BUSINESS_PHONE = process.env.NEXT_PUBLIC_WHATSAPP_BUSINESS_PHONE;

function subscribeToHydration(): () => void {
  return () => {};
}

function getClientHydrationSnapshot(): boolean {
  return true;
}

function getServerHydrationSnapshot(): boolean {
  return false;
}

function formatPrice(priceCop: number): string {
  return new Intl.NumberFormat("es-CO", {
    style: "currency",
    currency: "COP",
    maximumFractionDigits: 0,
  }).format(priceCop);
}

function getIdempotencyKey(cart: CartLine[]): string {
  const fingerprint = JSON.stringify(
    cart.map(({ productId, quantity, priceCop }) => ({ productId, quantity, priceCop })),
  );
  const stored = window.localStorage.getItem(IDEMPOTENCY_STORAGE_KEY);

  if (stored) {
    try {
      const parsed = JSON.parse(stored) as { fingerprint?: string; key?: string };
      if (parsed.fingerprint === fingerprint && parsed.key) {
        return parsed.key;
      }
    } catch {
      window.localStorage.removeItem(IDEMPOTENCY_STORAGE_KEY);
    }
  }

  const key = window.crypto.randomUUID();
  window.localStorage.setItem(IDEMPOTENCY_STORAGE_KEY, JSON.stringify({ fingerprint, key }));
  return key;
}

export function CatalogShell({ products, unavailable }: CatalogShellProps) {
  const router = useRouter();
  const isCartHydrated = useSyncExternalStore(
    subscribeToHydration,
    getClientHydrationSnapshot,
    getServerHydrationSnapshot,
  );
  const [cart, setCart] = useState<CartLine[]>(() => {
    if (typeof window === "undefined") {
      return [];
    }

    const rawCart = window.localStorage.getItem(STORAGE_KEY);
    if (!rawCart) {
      return [];
    }

    try {
      const parsed = JSON.parse(rawCart) as CartLine[];
      return Array.isArray(parsed) ? parsed : [];
    } catch {
      window.localStorage.removeItem(STORAGE_KEY);
      return [];
    }
  });
  const [isCartOpen, setIsCartOpen] = useState(false);
  const [orderConfirmed, setOrderConfirmed] = useState(false);
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [checkoutError, setCheckoutError] = useState<string | null>(null);

  useEffect(() => {
    if (!isCartHydrated) {
      return;
    }
    window.localStorage.setItem(STORAGE_KEY, JSON.stringify(cart));
  }, [cart, isCartHydrated]);

  const visibleCart = isCartHydrated ? cart : [];
  const cartCount = getCartItemCount(visibleCart);
  const checkoutSummary = buildCheckoutSummary(visibleCart);

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

  const handleCheckout = async () => {
    if (cart.length === 0 || isSubmitting) {
      return;
    }

    let whatsappWindow: Window | null = null;
    if (normalizeWhatsAppBusinessPhone(WHATSAPP_BUSINESS_PHONE)) {
      // Open synchronously from the user's click so the browser does not block
      // the later WhatsApp navigation after the order API request completes.
      whatsappWindow = window.open("about:blank", "_blank");
      if (whatsappWindow) {
        whatsappWindow.opener = null;
      }
    }

    setIsSubmitting(true);
    setCheckoutError(null);
    try {
      const sessionResponse = await fetch("/api/auth/me");
      if (!sessionResponse.ok) {
        whatsappWindow?.close();
        router.push("/login");
        return;
      }

      const idempotencyKey = getIdempotencyKey(cart);
      // POST goes through the Next.js API route so the server can attach
      // the httpOnly accessToken cookie as an Authorization header.
      // The client never touches the token directly.
      const response = await fetch("/api/orders", {
        method: "POST",
        headers: {
          "content-type": "application/json",
          "idempotency-key": idempotencyKey,
        },
        body: JSON.stringify({
          lines: cart.map((line) => ({
            productId: line.productId,
            sku: line.sku,
            name: line.name,
            quantity: line.quantity,
            unitPriceCop: line.priceCop,
          })),
        }),
      });

      if (!response.ok) {
        throw new Error("No se pudo confirmar la orden");
      }

      const payload = (await response.json()) as { data?: unknown };
      if (!isWhatsAppOrderSummary(payload.data)) {
        throw new Error("Orders service returned an invalid persisted order");
      }

      const persistedOrder: WhatsAppOrderSummary = payload.data;
      const whatsappUrl = buildWhatsAppOrderUrl(WHATSAPP_BUSINESS_PHONE, persistedOrder);
      if (whatsappWindow && whatsappUrl) {
        try {
          whatsappWindow.location.replace(whatsappUrl);
        } catch {
          whatsappWindow.close();
        }
      } else {
        whatsappWindow?.close();
      }

      window.localStorage.removeItem(IDEMPOTENCY_STORAGE_KEY);
      setOrderConfirmed(true);
      setCart([]);
      setIsCartOpen(true);
      router.push(`/checkout?orderId=${encodeURIComponent(persistedOrder.orderId)}`);
    } catch {
      whatsappWindow?.close();
      setCheckoutError("No pudimos confirmar la respuesta. Puedes volver a intentarlo sin duplicar tu pedido.");
    } finally {
      setIsSubmitting(false);
    }
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

        {visibleCart.length === 0 ? (
          orderConfirmed ? (
            <div className="notice notice-success" role="status">
              <strong>Pedido registrado.</strong>
              <span>Tu compra quedó guardada en MileShop. Revisa y envía el resumen que se abre en WhatsApp.</span>
            </div>
          ) : (
            <p className="empty-cart">Todavía no has agregado productos.</p>
          )
        ) : (
          <>
            <ul className="cart-items">
              {visibleCart.map((item) => (
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
                <span>Envío estimado</span>
                <strong>{checkoutSummary.isFreeDelivery ? "Gratis" : formatPrice(checkoutSummary.deliveryFeeCop)}</strong>
              </div>
              <div className="checkout-total">
                <span>Total</span>
                <strong>{formatPrice(checkoutSummary.totalCop)}</strong>
              </div>
            </div>

            <p className="notice">
              Al confirmar, guardaremos tu pedido y abriremos WhatsApp con el resumen para que lo revises y lo envíes.
              Si pagas por transferencia, adjunta el comprobante manualmente en ese chat.
            </p>
            <button className="checkout-button" type="button" onClick={handleCheckout}>
              {isSubmitting ? "Guardando pedido..." : "Confirmar y abrir WhatsApp"}
            </button>
            {checkoutError && <p className="notice-error" role="alert">{checkoutError}</p>}
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
