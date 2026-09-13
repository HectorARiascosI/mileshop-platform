import Link from "next/link";

type Product = {
  id: string;
  sku: string;
  name: string;
  description: string;
  priceCop: number;
  stock: number;
};

type CatalogResult = {
  products: Product[];
  unavailable: boolean;
};

async function getCatalog(): Promise<CatalogResult> {
  const gatewayUrl = process.env.API_GATEWAY_URL ?? "http://localhost:3000";

  try {
    const response = await fetch(`${gatewayUrl}/catalog/products`, {
      cache: "no-store",
    });

    if (!response.ok) {
      return { products: [], unavailable: true };
    }

    const payload = (await response.json()) as { data: Product[] };
    return { products: payload.data, unavailable: false };
  } catch {
    return { products: [], unavailable: true };
  }
}

function formatPrice(priceCop: number): string {
  return new Intl.NumberFormat("es-CO", {
    style: "currency",
    currency: "COP",
    maximumFractionDigits: 0,
  }).format(priceCop);
}

export default async function Home() {
  const { products, unavailable } = await getCatalog();

  return (
    <div className="site-shell">
      <header className="topbar">
        <Link className="brand" href="/" aria-label="MileShop inicio">
          <span className="brand-mark">M</span>
          <span>MileShop</span>
        </Link>
        <div className="topbar-meta">
          <span>Compra local, elige con calma</span>
          <button className="cart-button" type="button" aria-label="Ver carrito">
            Carrito <span className="cart-count">0</span>
          </button>
        </div>
      </header>

      <main className="catalog-page">
        <section className="intro" aria-labelledby="catalog-title">
          <div>
            <p className="eyebrow">Selección MileShop</p>
            <h1 id="catalog-title">Lo que necesitas,<br />sin complicaciones.</h1>
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
                  <p className="product-description">{product.description || "Una elección práctica para tu día a día."}</p>
                  <div className="product-footer">
                    <strong>{formatPrice(product.priceCop)}</strong>
                    <button className="add-button" type="button">Añadir <span aria-hidden="true">+</span></button>
                  </div>
                </div>
              </article>
            ))}
          </section>
        )}
      </main>

      <footer className="footer">
        <span>MileShop</span>
        <span>Catálogo en evolución</span>
      </footer>
    </div>
  );
}
