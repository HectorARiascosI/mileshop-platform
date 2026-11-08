"use client";

import Link from "next/link";
import Image from "next/image";
import { useRouter } from "next/navigation";
import { useEffect, useState, useSyncExternalStore, type SyntheticEvent } from "react";

import {
  DELIVERY_FEE_COP,
  DELIVERY_FEE_THRESHOLD_COP,
} from "@mileshop/contracts";
import type {
  CatalogAnnouncement,
  CatalogCategorySummary,
  CatalogProductImageSummary,
  CatalogPromotion,
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
  isWhatsAppCustomerDetails,
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
  promotions: CatalogPromotion[];
};

const STORAGE_KEY = "mileshop-cart-v1";
const IDEMPOTENCY_STORAGE_KEY = "mileshop-checkout-idempotency-v1";
const WHATSAPP_BUSINESS_PHONE = process.env.NEXT_PUBLIC_WHATSAPP_BUSINESS_PHONE;
const isWhatsAppBusinessConfigured =
  normalizeWhatsAppBusinessPhone(WHATSAPP_BUSINESS_PHONE) !== null;

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

function getProductImages(product: Product): CatalogProductImageSummary[] {
  if (product.images?.length) return product.images;
  return product.imageUrl ? [{ imageUrl: product.imageUrl, position: 0 }] : [];
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

export function CatalogShell({ products, unavailable, announcements, promotions }: CatalogShellProps) {
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
  const [productGalleryPreview, setProductGalleryPreview] = useState<{
    productId: string;
    index: number;
  } | null>(null);
  const [imageAspectRatios, setImageAspectRatios] = useState<Record<string, number>>({});
  const [isMenuOpen, setIsMenuOpen] = useState(false);

  useEffect(() => {
    if (!isCartHydrated) {
      return;
    }
    window.localStorage.setItem(STORAGE_KEY, JSON.stringify(cart));
  }, [cart, isCartHydrated]);

  useEffect(() => {
    if (!isCartOpen) {
      document.body.classList.remove("cart-is-open");
      return;
    }

    document.body.classList.add("cart-is-open");
    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape") {
        setIsCartOpen(false);
      }
    };
    window.addEventListener("keydown", handleKeyDown);
    return () => {
      document.body.classList.remove("cart-is-open");
      window.removeEventListener("keydown", handleKeyDown);
    };
  }, [isCartOpen]);

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
  const previewProduct = productGalleryPreview
    ? products.find((product) => product.id === productGalleryPreview.productId)
    : undefined;
  const selectedCategory = categories.find((category) => category.id === selectedCategoryId);
  const activeTheme = previewProduct?.category?.theme ?? selectedCategory?.theme ?? "neutral";
  const previewImages = previewProduct ? getProductImages(previewProduct) : [];
  const previewIndex = Math.min(
    productGalleryPreview?.index ?? 0,
    Math.max(previewImages.length - 1, 0),
  );
  const previewImage = previewImages[previewIndex];

  const handleAddToCart = (product: Product) => {
    if (product.stock <= 0) return;
    setCart((currentCart) =>
      addProductToCart(currentCart, {
        productId: product.id,
        sku: product.sku,
        name: product.name,
        priceCop: product.priceCop,
        quantity: 1,
        imageUrl: product.images?.[0]?.imageUrl ?? product.imageUrl ?? null,
      }),
    );
    setIsCartOpen(true);
  };

  const moveGallery = (productId: string, offset: -1 | 1, imageCount: number) => {
    setGalleryIndices((current) => ({
      ...current,
      [productId]: ((current[productId] ?? 0) + offset + imageCount) % imageCount,
    }));
    setProductGalleryPreview((current) =>
      current?.productId === productId
        ? { ...current, index: (current.index + offset + imageCount) % imageCount }
        : current,
    );
  };

  const selectGalleryImage = (productId: string, index: number) => {
    setGalleryIndices((current) => ({ ...current, [productId]: index }));
    setProductGalleryPreview((current) =>
      current?.productId === productId ? { ...current, index } : current,
    );
  };

  const openProductGallery = (productId: string, index: number) => {
    setGalleryIndices((current) => ({ ...current, [productId]: index }));
    setProductGalleryPreview({ productId, index });
  };

  useEffect(() => {
    if (!productGalleryPreview) return;
    document.body.classList.add("product-gallery-is-open");
    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape") {
        setProductGalleryPreview(null);
        return;
      }
      if (event.key !== "ArrowLeft" && event.key !== "ArrowRight") return;
      const product = products.find((candidate) => candidate.id === productGalleryPreview.productId);
      if (!product) return;
      const imageCount = getProductImages(product).length;
      if (imageCount < 2) return;
      event.preventDefault();
      const offset = event.key === "ArrowRight" ? 1 : -1;
      setGalleryIndices((current) => ({
        ...current,
        [product.id]: ((current[product.id] ?? 0) + offset + imageCount) % imageCount,
      }));
      setProductGalleryPreview((current) =>
        current?.productId === product.id
          ? { ...current, index: (current.index + offset + imageCount) % imageCount }
          : current,
      );
    };
    window.addEventListener("keydown", handleKeyDown);
    return () => {
      document.body.classList.remove("product-gallery-is-open");
      window.removeEventListener("keydown", handleKeyDown);
    };
  }, [productGalleryPreview, products]);

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
    if (!isWhatsAppBusinessConfigured) {
      setCheckoutError(
        "No se puede registrar el pedido porque WhatsApp Business no está configurado. No se creó la orden ni se reservó inventario.",
      );
      return;
    }

    let whatsappWindow: Window | null = null;
    if (isWhatsAppBusinessConfigured) {
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
      const customer: unknown = await sessionResponse.json().catch(() => null);
      if (!isWhatsAppCustomerDetails(customer)) {
        whatsappWindow?.close();
        setCheckoutError(
          "No pudimos consultar tu nombre y datos de contacto. Vuelve a iniciar sesión e inténtalo nuevamente.",
        );
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
      const whatsappUrl = buildWhatsAppOrderUrl(WHATSAPP_BUSINESS_PHONE, persistedOrder, customer);
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
    <div className="site-shell" data-theme={activeTheme}>
      <header className="topbar">
        <Link className="brand" href="/" aria-label="MileShop inicio">
          <Image className="brand-mark" src="/mileshop-mark.webp" alt="" width={60} height={60} priority />
          <span className="brand-copy">
            <span className="brand-name">MileShop</span>
            <span className="brand-tagline">La exclusividad hecha a tu medida.</span>
          </span>
        </Link>

        <nav className="topbar-nav" aria-label="Navegación principal">
          <a className="topbar-link" href="#catalogo">Catálogo</a>
          {isStoreAdmin && (
            <Link className="topbar-link" href="/admin/orders" aria-label="Administrar MileShop">
              Administración
            </Link>
          )}
        </nav>

        <div className="store-actions">
          <Link className="store-icon-button" href="/login" aria-label="Cuenta">
            <svg aria-hidden="true" viewBox="0 0 24 24" fill="none">
              <circle cx="12" cy="8" r="3.25" />
              <path d="M5.5 19c.8-3.15 3-4.75 6.5-4.75S17.7 15.85 18.5 19" />
            </svg>
          </Link>
          <Link className="store-icon-button" href="/login?view=orders" aria-label="Mis pedidos">
            <svg aria-hidden="true" viewBox="0 0 24 24" fill="none">
              <path d="M4.75 7.25h14.5l-1 12h-12.5l-1-12Z" />
              <path d="M8 8V6a4 4 0 0 1 8 0v2" />
            </svg>
          </Link>
          <button
            className="cart-button"
            type="button"
            aria-label={`Ver carrito, ${cartCount} productos`}
            aria-expanded={isCartOpen}
            onClick={() => setIsCartOpen((current) => !current)}
          >
            <svg aria-hidden="true" viewBox="0 0 24 24" fill="none">
              <path d="M4.75 7.25h14.5l-1 12h-12.5l-1-12Z" />
              <path d="M8 8V6a4 4 0 0 1 8 0v2" />
            </svg>
            <span className="cart-count" aria-hidden="true">{cartCount}</span>
          </button>
          <button
            className="store-menu-button"
            type="button"
            aria-label={isMenuOpen ? "Cerrar menú" : "Abrir menú"}
            aria-expanded={isMenuOpen}
            onClick={() => setIsMenuOpen((current) => !current)}
          >
            <span />
            <span />
          </button>
        </div>
      </header>

      <div className={`store-menu-panel${isMenuOpen ? " is-open" : ""}`} aria-hidden={!isMenuOpen}>
        <div>
          <p>Explorar MileShop</p>
          <a href="#catalogo" onClick={() => setIsMenuOpen(false)}>Catálogo</a>
          <Link href="/login" onClick={() => setIsMenuOpen(false)}>Mi cuenta</Link>
          <Link href="/login?view=orders" onClick={() => setIsMenuOpen(false)}>Mis pedidos</Link>
          {isStoreAdmin && (
            <Link href="/admin/orders" onClick={() => setIsMenuOpen(false)}>Administración</Link>
          )}
        </div>
      </div>

      <main className="catalog-page">
        {announcements.length > 0 && (
          <section className="announcement-stack" aria-label="Anuncios de MileShop">
            {announcements.map((announcement) => (
              <article className="announcement-banner" key={announcement.id}>
                {announcement.imageUrl && (
                  <div className="announcement-image">
                    <Image
                      src={getOptimizedImageUrl(announcement.imageUrl, 480)}
                      alt={`Imagen del anuncio: ${announcement.title}`}
                      fill
                      sizes="(max-width: 760px) 100vw, 180px"
                      unoptimized
                    />
                  </div>
                )}
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
              <span className="hero-image-empty" role="img" aria-label="Aún no hay una fotografía destacada">
                <span className="hero-image-empty-icon" aria-hidden="true">
                  <svg viewBox="0 0 24 24" fill="none">
                    <rect x="3" y="4" width="18" height="16" rx="3" />
                    <circle cx="8.5" cy="9.5" r="1.5" />
                    <path d="m5 17 4.7-4.7 3.1 3.1 2.1-2.1L19 17" />
                  </svg>
                </span>
                <strong>Imagen destacada</strong>
                <small>Agrega una foto al primer producto activo para mostrarla aquí.</small>
              </span>
            )}
          </div>
        </section>

        {promotions.length > 0 && (
          <section className="promotion-showcase" aria-labelledby="promotion-showcase-title">
            <header className="promotion-showcase-heading">
              <p className="eyebrow">Ofertas de temporada</p>
              <h2 id="promotion-showcase-title">Promociones vigentes</h2>
              <p>Descuentos activos aplicados directamente al precio de los productos.</p>
            </header>
            <div className="promotion-showcase-grid">
              {promotions.map((promotion) => (
                <article className="promotion-feature-card" key={promotion.id}>
                  {promotion.imageUrl && (
                    <div className="promotion-feature-image">
                      <Image
                        src={getOptimizedImageUrl(promotion.imageUrl, 960)}
                        alt={`Imagen de la promoción: ${promotion.title}`}
                        fill
                        sizes="(max-width: 760px) 100vw, 50vw"
                        unoptimized
                      />
                      <span>
                        Hasta {Math.max(...promotion.products.map((product) => product.discountPercent))}% menos
                      </span>
                    </div>
                  )}
                  <div className="promotion-feature-content">
                    <p className="promotion-feature-eyebrow">Promoción activa</p>
                    <h3>{promotion.title}</h3>
                    {promotion.description && <p>{promotion.description}</p>}
                    <ul aria-label={`Productos incluidos en ${promotion.title}`}>
                      {promotion.products.slice(0, 3).map((product) => (
                        <li key={product.productId}>
                          <span>{product.name}</span>
                          <strong>{product.discountPercent}% menos</strong>
                        </li>
                      ))}
                    </ul>
                    {promotion.products.length > 3 && (
                      <p className="promotion-more-products">
                        Y {promotion.products.length - 3} productos más en esta campaña.
                      </p>
                    )}
                    <a href="#catalogo">Ver productos con descuento</a>
                  </div>
                </article>
              ))}
            </div>
          </section>
        )}

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
                data-theme="neutral"
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
                  data-theme={category.theme}
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
                const productImages = getProductImages(product);
                const galleryIndex = Math.min(
                  galleryIndices[product.id] ?? 0,
                  Math.max(productImages.length - 1, 0),
                );
                const currentImage = productImages[galleryIndex];
                return (
                  <li className="product-card" key={product.id} data-theme={product.category?.theme ?? "neutral"}>
                  <div className="product-art">
                    {currentImage ? (
                      <button
                        className="product-image-trigger"
                        type="button"
                        aria-label={`Ampliar foto ${galleryIndex + 1} de ${product.name}`}
                        style={{ aspectRatio: imageAspectRatios[currentImage.imageUrl] ?? 1 }}
                        onClick={() => openProductGallery(product.id, galleryIndex)}
                      >
                        <Image
                          className="product-image"
                          src={getOptimizedImageUrl(currentImage.imageUrl, 1000)}
                          alt={`${product.name}, foto ${galleryIndex + 1} de ${productImages.length}`}
                          fill
                          sizes="(max-width: 480px) 46vw, (max-width: 760px) 44vw, (max-width: 1100px) 30vw, 22vw"
                          unoptimized
                          onLoad={(event: SyntheticEvent<HTMLImageElement>) => {
                            const { naturalWidth, naturalHeight } = event.currentTarget;
                            if (!naturalWidth || !naturalHeight) return;
                            const aspectRatio = Math.min(
                              1.6,
                              Math.max(0.72, naturalWidth / naturalHeight),
                            );
                            setImageAspectRatios((current) =>
                              current[currentImage.imageUrl] === aspectRatio
                                ? current
                                : { ...current, [currentImage.imageUrl]: aspectRatio },
                            );
                          }}
                        />
                        <span className="product-image-hint">Ampliar</span>
                      </button>
                    ) : (
                      <div className="product-image-fallback" aria-label={`Fotografía no disponible para ${product.name}`}>
                        <span className="fallback-mark" aria-hidden="true">
                          <svg viewBox="0 0 24 24" fill="none">
                            <rect x="3" y="4" width="18" height="16" rx="3" />
                            <circle cx="8.5" cy="9.5" r="1.5" />
                            <path d="m5 17 4.7-4.7 3.1 3.1 2.1-2.1L19 17" />
                          </svg>
                        </span>
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
                  {productImages.length > 1 && (
                    <div className="product-gallery-thumbnails" role="group" aria-label={`Elegir foto de ${product.name}`}>
                      {productImages.map((image, index) => (
                        <button
                          className={`product-gallery-thumbnail${index === galleryIndex ? " is-selected" : ""}`}
                          key={`${image.position}-${image.imageUrl}`}
                          type="button"
                          aria-label={`Mostrar foto ${index + 1} de ${product.name}`}
                          aria-pressed={index === galleryIndex}
                          onClick={() => selectGalleryImage(product.id, index)}
                        >
                          <Image
                            src={getOptimizedImageUrl(image.imageUrl, 120)}
                            alt=""
                            fill
                            sizes="56px"
                            unoptimized
                          />
                        </button>
                      ))}
                    </div>
                  )}

                  <div className="product-info">
                    <p className={`product-stock${product.stock <= 0 ? " is-unavailable" : ""}`}>
                      {product.stock > 0 ? "Disponible" : "Agotado"}
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

      {previewProduct && previewImage && (
        <div
          className="product-gallery-backdrop"
          role="presentation"
          onClick={(event) => {
            if (event.target === event.currentTarget) setProductGalleryPreview(null);
          }}
        >
          <section
            className="product-gallery-dialog"
            data-theme={previewProduct.category?.theme ?? "neutral"}
            role="dialog"
            aria-modal="true"
            aria-labelledby="product-gallery-title"
          >
            <header className="product-gallery-dialog-header">
              <div>
                <h2 id="product-gallery-title">{previewProduct.name}</h2>
                <p aria-live="polite">
                  Foto {previewIndex + 1} de {previewImages.length}
                </p>
              </div>
              <button
                className="product-gallery-close"
                type="button"
                aria-label="Cerrar vista de fotos"
                onClick={() => setProductGalleryPreview(null)}
              >
                ×
              </button>
            </header>
            <div
              className="product-gallery-lightbox-image"
              style={{
                aspectRatio: imageAspectRatios[previewImage.imageUrl] ?? 1,
              }}
            >
              <Image
                src={getOptimizedImageUrl(previewImage.imageUrl, 1800)}
                alt={`${previewProduct.name}, foto ${previewIndex + 1} de ${previewImages.length}`}
                fill
                sizes="(max-width: 760px) 92vw, 1000px"
                unoptimized
                priority
                onLoad={(event: SyntheticEvent<HTMLImageElement>) => {
                  const { naturalWidth, naturalHeight } = event.currentTarget;
                  if (!naturalWidth || !naturalHeight) return;
                  const aspectRatio = Math.min(1.6, Math.max(0.72, naturalWidth / naturalHeight));
                  setImageAspectRatios((current) =>
                    current[previewImage.imageUrl] === aspectRatio
                      ? current
                      : { ...current, [previewImage.imageUrl]: aspectRatio },
                  );
                }}
              />
            </div>
            {previewImages.length > 1 && (
              <>
                <div className="product-gallery-dialog-controls">
                  <button
                    className="product-gallery-dialog-button"
                    type="button"
                    onClick={() => moveGallery(previewProduct.id, -1, previewImages.length)}
                  >
                    Anterior
                  </button>
                  <button
                    className="product-gallery-dialog-button"
                    type="button"
                    onClick={() => moveGallery(previewProduct.id, 1, previewImages.length)}
                  >
                    Siguiente
                  </button>
                </div>
                <div className="product-gallery-dialog-thumbnails" role="group" aria-label="Fotos del producto">
                  {previewImages.map((image, index) => (
                    <button
                      className={`product-gallery-thumbnail${index === previewIndex ? " is-selected" : ""}`}
                      key={`${image.position}-${image.imageUrl}`}
                      type="button"
                      aria-label={`Mostrar foto ${index + 1} de ${previewProduct.name}`}
                      aria-pressed={index === previewIndex}
                      onClick={() => selectGalleryImage(previewProduct.id, index)}
                    >
                      <Image
                        src={getOptimizedImageUrl(image.imageUrl, 120)}
                        alt=""
                        fill
                        sizes="56px"
                        unoptimized
                      />
                    </button>
                  ))}
                </div>
              </>
            )}
          </section>
        </div>
      )}

      <button
        className={`cart-backdrop ${isCartOpen ? "is-open" : ""}`}
        type="button"
        aria-label="Cerrar carrito"
        tabIndex={isCartOpen ? 0 : -1}
        onClick={() => setIsCartOpen(false)}
      />
      <aside
        className={`cart-panel ${isCartOpen ? "is-open" : ""}`}
        aria-live="polite"
        aria-hidden={!isCartOpen}
        inert={!isCartOpen ? true : undefined}
      >
        <div className="cart-panel-header">
          <div>
            <h2>CARRITO</h2>
          </div>
          <button className="close-cart" type="button" aria-label="Cerrar carrito" onClick={() => setIsCartOpen(false)}>
            <span aria-hidden="true">×</span>
            <span className="close-cart-label" aria-hidden="true">Cerrar</span>
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
                  {(() => {
                    const product = products.find((candidate) => candidate.id === item.productId);
                    const imageUrl =
                      item.imageUrl ?? product?.images?.[0]?.imageUrl ?? product?.imageUrl;
                    return imageUrl ? (
                      <Image
                        className="cart-item-image"
                        src={getOptimizedImageUrl(imageUrl, 180)}
                        alt=""
                        width={72}
                        height={72}
                        sizes="72px"
                        unoptimized
                      />
                    ) : (
                      <div className="cart-item-image cart-item-image-fallback" aria-hidden="true">
                        {item.name.charAt(0).toUpperCase()}
                      </div>
                    );
                  })()}
                  <div className="cart-item-details">
                    <div>
                      <strong>{item.name}</strong>
                      <span>{formatPrice(item.priceCop)}</span>
                    </div>
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
              <p className={`delivery-policy-notice${checkoutSummary.isFreeDelivery ? " is-free" : ""}`}>
                {checkoutSummary.isFreeDelivery
                  ? `Tu compra alcanza ${formatPrice(DELIVERY_FEE_THRESHOLD_COP)}. El envío es gratis.`
                  : `El envío cuesta ${formatPrice(DELIVERY_FEE_COP)} en compras menores a ${formatPrice(DELIVERY_FEE_THRESHOLD_COP)}. Agrega ${formatPrice(DELIVERY_FEE_THRESHOLD_COP - checkoutSummary.subtotalCop)} para obtener envío gratis.`}
              </p>
              <div className="checkout-total">
                <span>Total</span>
                <strong>{formatPrice(checkoutSummary.totalCop)}</strong>
              </div>
            </div>

            {isWhatsAppBusinessConfigured ? (
              <p className="notice">
                Al confirmar, guardaremos tu pedido y abriremos WhatsApp con el resumen para que lo revises y lo envíes.
                <strong className="payment-proof-note">Si pagas por transferencia, adjunta el comprobante manualmente en este chat, por foto o archivo.</strong>
              </p>
            ) : (
              <p className="notice-error" role="alert">
                El canal de WhatsApp Business de MileShop no está configurado. No se registrará el pedido ni se reservará inventario hasta que la tienda habilite el contacto.
              </p>
            )}
            <button
              className="checkout-button whatsapp-checkout-button"
              type="button"
              onClick={handleCheckout}
              disabled={isSubmitting || !isWhatsAppBusinessConfigured}
            >
              <svg className="whatsapp-icon" viewBox="0 0 24 24" aria-hidden="true">
                <path d="M20.52 3.48A11.82 11.82 0 0 0 12.09 0 11.91 11.91 0 0 0 .21 11.89c0 2.09.55 4.14 1.59 5.94L0 24l6.32-1.66a11.96 11.96 0 0 0 5.76 1.47h.01A11.91 11.91 0 0 0 24 11.91a11.82 11.82 0 0 0-3.48-8.43Zm-8.43 18.4h-.01a9.91 9.91 0 0 1-5.05-1.38l-.36-.21-3.75.98 1-3.66-.24-.38a9.91 9.91 0 1 1 18.35-5.32 9.93 9.93 0 0 1-9.94 9.97Zm5.44-7.43c-.3-.15-1.77-.87-2.04-.97-.27-.1-.47-.15-.67.15-.2.3-.77.97-.95 1.17-.17.2-.35.22-.65.07-.3-.15-1.25-.46-2.38-1.47-.88-.78-1.47-1.75-1.64-2.05-.17-.3-.02-.46.13-.61.13-.13.3-.35.45-.52.15-.17.2-.3.3-.5.1-.2.05-.37-.02-.52-.08-.15-.67-1.62-.92-2.22-.24-.58-.49-.5-.67-.51h-.57c-.2 0-.52.07-.79.37-.27.3-1.04 1.02-1.04 2.49 0 1.47 1.07 2.89 1.22 3.09.15.2 2.1 3.21 5.09 4.5.71.31 1.27.49 1.7.63.71.23 1.36.2 1.87.12.57-.08 1.77-.72 2.02-1.42.25-.7.25-1.3.17-1.42-.07-.13-.27-.2-.57-.35Z" />
              </svg>
              {!isWhatsAppBusinessConfigured
                ? "Pedidos temporalmente no disponibles"
                : isSubmitting
                  ? "Guardando pedido..."
                  : "Confirmar y abrir WhatsApp"}
            </button>
            {checkoutError && <p className="notice-error" role="alert">{checkoutError}</p>}
          </>
        )}
      </aside>

      <footer className="footer">
        <span className="footer-brand">MileShop · La exclusividad hecha a tu medida.</span>
        <a href="#catalogo">Explorar productos</a>
      </footer>
    </div>
  );
}
