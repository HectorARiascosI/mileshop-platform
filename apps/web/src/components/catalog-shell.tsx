"use client";

import Link from "next/link";
import Image from "next/image";
import { useRouter } from "next/navigation";
import { useEffect, useState, useSyncExternalStore } from "react";

import type {
  CatalogAnnouncement,
  CatalogCategorySummary,
  CatalogProductImageSummary,
  CatalogProductPromotion,
} from "@mileshop/contracts";
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
import { getOptimizedImageUrl } from "@/lib/imagekit-url";
import { filterCatalogProducts } from "@/lib/catalog-search";

type Product = {
  id: string;
  sku: string;
  name: string;
  description: string;
  priceCop: number;
  stock: number;
  priceBeforeDiscountCop?: number;
  promotion?: CatalogProductPromotion | null;
  imageUrl?: string | null;
  images?: CatalogProductImageSummary[];
  categoryId?: string | null;
  category?: CatalogCategorySummary | null;
};

type CatalogShellProps = {
  products: Product[];
  unavailable: boolean;
  announcements: CatalogAnnouncement[];
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

export function CatalogShell({ products, unavailable, announcements }: CatalogShellProps) {
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
  const [isStoreAdmin, setIsStoreAdmin] = useState(false);
  const [searchQuery, setSearchQuery] = useState("");
  const [selectedCategoryId, setSelectedCategoryId] = useState<string | null>(null);
  const [galleryIndices, setGalleryIndices] = useState<Record<string, number>>({});

  useEffect(() => {
    if (!isCartHydrated) {
      return;
    }
    window.localStorage.setItem(STORAGE_KEY, JSON.stringify(cart));
  }, [cart, isCartHydrated]);

  useEffect(() => {
    let active = true;
    void fetch("/api/auth/me", { cache: "no-store" })
      .then(async (response) => {
        if (!response.ok) return;
        const profile: unknown = await response.json();
        if (
          active &&
          typeof profile === "object" &&
          profile !== null &&
          "role" in profile
        ) {
          setIsStoreAdmin(profile.role === "STORE_ADMIN");
        }
      })
      .catch(() => {
        if (active) setIsStoreAdmin(false);
      });
    return () => {
      active = false;
    };
  }, []);

  const visibleCart = isCartHydrated ? cart : [];
  const cartCount = getCartItemCount(visibleCart);
  const checkoutSummary = buildCheckoutSummary(visibleCart);
  const heroProduct = products.find((product) => product.imageUrl);
  const categoriesById = new Map<string, CatalogCategorySummary>();
  for (const product of products) {
    if (product.category) categoriesById.set(product.category.id, product.category);
  }
  const categories = [...categoriesById.values()].sort((left, right) =>
    left.name.localeCompare(right.name, "es"),
  );
  const visibleProducts = filterCatalogProducts(products, searchQuery, selectedCategoryId);

  const handleAddToCart = (product: Product) => {
    if (product.stock <= 0) return;
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

  const moveGallery = (productId: string, offset: -1 | 1, imageCount: number) => {
    setGalleryIndices((current) => ({
      ...current,
      [productId]: ((current[productId] ?? 0) + offset + imageCount) % imageCount,
    }));
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
          <span className="brand-mark" aria-hidden="true">M</span>
          <span className="brand-name">MileShop</span>
        </Link>

        <nav className="topbar-nav" aria-label="Navegación principal">
          <a className="topbar-link" href="#catalogo">Catálogo</a>
          {isStoreAdmin && (
            <Link className="topbar-link" href="/admin/orders" aria-label="Administrar MileShop">
              Administración
            </Link>
          )}
        </nav>

        <button
          className="cart-button"
          type="button"
          aria-label={`Ver carrito, ${cartCount} productos`}
          aria-expanded={isCartOpen}
          onClick={() => setIsCartOpen((current) => !current)}
        >
          <span>Carrito</span>
          <span className="cart-count" aria-hidden="true">{cartCount}</span>
        </button>
      </header>

      <main className="catalog-page">
        {announcements.length > 0 && (
          <section className="announcement-stack" aria-label="Anuncios de MileShop">
            {announcements.map((announcement) => (
              <article className="announcement-banner" key={announcement.id}>
                <div>
                  <p className="announcement-eyebrow">Aviso de la tienda</p>
                  <h2>{announcement.title}</h2>
                  <p>{announcement.message}</p>
                </div>
                {announcement.linkUrl && announcement.linkLabel && (
                  <a
                    className="announcement-link"
                    href={announcement.linkUrl}
                    target="_blank"
                    rel="noopener noreferrer"
                  >
                    {announcement.linkLabel}
                    <span aria-hidden="true">↗</span>
                  </a>
                )}
              </article>
            ))}
          </section>
        )}
        <section className="storefront-hero" aria-labelledby="storefront-title">
          <div className="hero-copy">
            <p className="eyebrow">Selección de temporada</p>
            <h1 id="storefront-title">
              Encuentra
              <br />
              lo que buscas<span>.</span>
            </h1>
            <p className="hero-description">
              Explora los productos disponibles, revisa sus detalles y prepara tu pedido para continuar por WhatsApp.
            </p>
            <a className="hero-cta" href="#catalogo">
              Explorar el catálogo
              <svg aria-hidden="true" viewBox="0 0 20 20" fill="none">
                <path d="M4.5 10h11m-4.5-4.5L15.5 10 11 14.5" />
              </svg>
            </a>
          </div>

          <div className={`hero-visual${heroProduct ? " has-product-image" : ""}`}>
            <span className="hero-orbit hero-orbit-outer" aria-hidden="true" />
            <span className="hero-orbit hero-orbit-inner" aria-hidden="true" />
            {heroProduct?.imageUrl ? (
              <Image
                className="hero-product-image"
                src={getOptimizedImageUrl(heroProduct.imageUrl, 1200)}
                alt={heroProduct.name}
                width={720}
                height={640}
                sizes="(max-width: 760px) 100vw, 56vw"
                unoptimized
              />
            ) : (
              <span className="hero-monogram" aria-hidden="true">NUEVO</span>
            )}
          </div>
        </section>

        <section className="catalog-section" id="catalogo" aria-labelledby="catalog-title">
          <div className="catalog-heading">
            <div>
              <p className="eyebrow">Todo disponible</p>
              <h2 id="catalog-title">Catálogo</h2>
              <p className="catalog-intro">
                Revisa precios y disponibilidad antes de agregar productos al carrito.
              </p>
            </div>
            {!unavailable && (
              <p className="product-count" aria-live="polite">
                {searchQuery.trim() || selectedCategoryId
                  ? `${visibleProducts.length} ${visibleProducts.length === 1 ? "resultado" : "resultados"}`
                  : `${products.length} ${products.length === 1 ? "producto" : "productos"}`}
              </p>
            )}
          </div>

          {!unavailable && products.length > 0 && (
            <label className="catalog-search">
              <svg aria-hidden="true" viewBox="0 0 20 20" fill="none">
                <circle cx="8.75" cy="8.75" r="5.75" />
                <path d="m13 13 4 4" />
              </svg>
              <span className="visually-hidden">Buscar en el catálogo</span>
              <input
                type="search"
                value={searchQuery}
                onChange={(event) => setSearchQuery(event.target.value)}
                placeholder="Buscar por nombre o código"
                autoComplete="off"
              />
              {searchQuery && (
                <button type="button" className="clear-search" onClick={() => setSearchQuery("")}>
                  Limpiar
                </button>
              )}
            </label>
          )}

          {!unavailable && categories.length > 0 && (
            <div className="category-filters" role="group" aria-label="Filtrar por categoría">
              <button
                className="category-filter"
                type="button"
                aria-pressed={selectedCategoryId === null}
                onClick={() => setSelectedCategoryId(null)}
              >
                Todas
              </button>
              {categories.map((category) => (
                <button
                  className="category-filter"
                  type="button"
                  key={category.id}
                  aria-pressed={selectedCategoryId === category.id}
                  onClick={() => setSelectedCategoryId(category.id)}
                >
                  {category.name}
                </button>
              ))}
            </div>
          )}

          {unavailable ? (
            <section className="notice notice-error" role="alert">
              <strong>No pudimos cargar el catálogo.</strong>
              <span>Vuelve a intentarlo en unos momentos.</span>
              <button className="add-button self-start" type="button" onClick={() => router.refresh()}>
                Volver a intentar
              </button>
            </section>
          ) : products.length === 0 ? (
            <section className="notice" role="status">
              <strong>No hay productos disponibles en este momento.</strong>
              <span>Consulta nuevamente más tarde para ver los productos de MileShop.</span>
            </section>
          ) : visibleProducts.length === 0 ? (
            <section className="notice catalog-no-results" role="status">
              <strong>No encontramos productos con ese criterio.</strong>
              <span>Prueba con otro nombre o código de producto.</span>
              <button
                className="add-button self-start"
                type="button"
                onClick={() => {
                  setSearchQuery("");
                  setSelectedCategoryId(null);
                }}
              >
                Ver todos los productos
              </button>
            </section>
          ) : (
            <ul className="product-grid" aria-label="Productos disponibles">
              {visibleProducts.map((product) => {
                const productImages = product.images?.length
                  ? product.images
                  : product.imageUrl
                    ? [{ imageUrl: product.imageUrl, position: 0 }]
                    : [];
                const galleryIndex = Math.min(
                  galleryIndices[product.id] ?? 0,
                  Math.max(productImages.length - 1, 0),
                );
                const currentImage = productImages[galleryIndex];
                return (
                  <li className="product-card" key={product.id} data-theme={product.category?.theme ?? "neutral"}>
                  <div className="product-art">
                    {currentImage ? (
                      <Image
                        className="product-image"
                        src={getOptimizedImageUrl(currentImage.imageUrl, 800)}
                        alt={`${product.name}, foto ${galleryIndex + 1} de ${productImages.length}`}
                        width={600}
                        height={480}
                        sizes="(max-width: 480px) 46vw, (max-width: 760px) 44vw, (max-width: 1100px) 30vw, 22vw"
                        unoptimized
                      />
                    ) : (
                      <div className="product-image-fallback" aria-label={`Fotografía no disponible para ${product.name}`}>
                        <span className="fallback-mark" aria-hidden="true">M</span>
                        <span>Fotografía no disponible</span>
                      </div>
                    )}
                    {productImages.length > 1 && (
                      <div
                        className="product-gallery-controls"
                        role="group"
                        aria-label={`Fotos de ${product.name}`}
                      >
                        <button
                          className="product-gallery-button"
                          type="button"
                          aria-label={`Ver foto anterior de ${product.name}`}
                          onClick={() => moveGallery(product.id, -1, productImages.length)}
                        >
                          Anterior
                        </button>
                        <span aria-live="polite">
                          {galleryIndex + 1} / {productImages.length}
                        </span>
                        <button
                          className="product-gallery-button"
                          type="button"
                          aria-label={`Ver siguiente foto de ${product.name}`}
                          onClick={() => moveGallery(product.id, 1, productImages.length)}
                        >
                          Siguiente
                        </button>
                      </div>
                    )}
                  </div>

                  <div className="product-info">
                    <p className={`product-stock${product.stock <= 0 ? " is-unavailable" : ""}`}>
                      <span className="stock-indicator" aria-hidden="true" />
                      {product.stock > 0 ? `${product.stock} disponibles` : "Agotado"}
                    </p>
                    {product.category && (
                      <p className="product-category">{product.category.name}</p>
                    )}
                    <h3>{product.name}</h3>
                    {product.description && (
                      <p className="product-description">{product.description}</p>
                    )}

                    <div className="product-footer">
                      <div className="product-price-block">
                        {product.promotion && product.priceBeforeDiscountCop !== undefined && (
                          <>
                            <span className="discount-tag">
                              {product.promotion.discountPercent}% menos
                            </span>
                            <del>{formatPrice(product.priceBeforeDiscountCop)}</del>
                          </>
                        )}
                        <strong>{formatPrice(product.priceCop)}</strong>
                      </div>
                      <button
                        className="add-button"
                        type="button"
                        onClick={() => handleAddToCart(product)}
                        disabled={product.stock <= 0}
                        aria-label={`Agregar ${product.name} al carrito`}
                      >
                        Agregar
                        <span aria-hidden="true">+</span>
                      </button>
                    </div>
                  </div>
                  </li>
                );
              })}
            </ul>
          )}
        </section>
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
        <span className="footer-brand">MileShop</span>
        <a href="#catalogo">Explorar productos</a>
      </footer>
    </div>
  );
}
