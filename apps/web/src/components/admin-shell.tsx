"use client";

import Link from "next/link";
import Image from "next/image";
import { usePathname } from "next/navigation";
import { useEffect, useState, type ReactNode } from "react";

const navigation = [
  { href: "/admin/orders", label: "Pedidos", icon: "orders" },
  { href: "/admin/catalog", label: "Catálogo", icon: "catalog" },
  { href: "/admin/catalog/promotions", label: "Promociones", icon: "promotions" },
  { href: "/admin/catalog/announcements", label: "Anuncios", icon: "announcements" },
  { href: "/admin/payments", label: "Pagos", icon: "payments" },
];

function AdminNavIcon({ icon }: { icon: string }) {
  const paths: Record<string, ReactNode> = {
    orders: <><path d="M6 7h12M6 12h12M6 17h8" /><path d="M4 4v16h16V4H4Z" /></>,
    catalog: <><path d="M4 7.5h16M4 12h16M4 16.5h16" /><rect x="4" y="4" width="16" height="16" rx="2.5" /></>,
    promotions: <><path d="m12 3 2.1 4.9L19 10l-4.9 2.1L12 17l-2.1-4.9L5 10l4.9-2.1L12 3Z" /><path d="M19 17v4M17 19h4" /></>,
    announcements: <><path d="M4 13h3l8 4V7l-8 4H4v2Z" /><path d="M18 8.5a5 5 0 0 1 0 7" /></>,
    payments: <><rect x="3" y="5" width="18" height="14" rx="3" /><path d="M3 9h18M7 15h3" /></>,
  };

  return (
    <svg className="admin-nav-icon" viewBox="0 0 24 24" fill="none" aria-hidden="true">
      {paths[icon]}
    </svg>
  );
}

type AdminShellProps = {
  children: ReactNode;
};

export function AdminShell({ children }: AdminShellProps) {
  const pathname = usePathname();
  const [authorized, setAuthorized] = useState<boolean | null>(null);

  useEffect(() => {
    let active = true;
    void fetch("/api/auth/me", { cache: "no-store" })
      .then(async (response) => {
        if (!response.ok) {
          if (active) setAuthorized(false);
          return;
        }
        const profile: unknown = await response.json();
        if (
          active &&
          typeof profile === "object" &&
          profile !== null &&
          "role" in profile &&
          profile.role === "STORE_ADMIN"
        ) {
          setAuthorized(true);
        } else if (active) {
          setAuthorized(false);
        }
      })
      .catch(() => {
        if (active) setAuthorized(false);
      });
    return () => {
      active = false;
    };
  }, []);

  if (authorized === false) {
    return (
      <main className="admin-access-state">
        <section>
          <span className="admin-access-mark" aria-hidden="true">
            <svg viewBox="0 0 24 24" fill="none">
              <rect x="5" y="10" width="14" height="11" rx="2.5" />
              <path d="M8.5 10V7.5a3.5 3.5 0 0 1 7 0V10" />
              <circle cx="12" cy="15.5" r="1" />
            </svg>
          </span>
          <p className="admin-kicker">Acceso administrativo</p>
          <h1>Esta sección es privada</h1>
          <p>Inicia sesión con una cuenta administradora para continuar.</p>
          <Link href="/login?next=/admin/orders">Iniciar sesión</Link>
          <Link href="/">Volver a la tienda</Link>
        </section>
      </main>
    );
  }

  return (
    <div className="admin-app-shell">
      <aside className="admin-sidebar" aria-label="Navegación administrativa">
        <Link className="admin-sidebar-brand" href="/">
          <Image src="/mileshop-logo.webp" alt="" width={48} height={48} />
          <span className="admin-brand-copy">
            <strong>MileShop</strong>
            <small>La exclusividad hecha a tu medida.</small>
          </span>
        </Link>
        <nav>
          {navigation.map((item) => {
            const active = item.href === "/admin/catalog"
              ? pathname === "/admin/catalog"
              : pathname === item.href;
            return (
              <Link
                key={item.href}
                href={item.href}
                aria-current={active ? "page" : undefined}
                className={active ? "is-active" : undefined}
              >
                <AdminNavIcon icon={item.icon} />
                <span>{item.label}</span>
              </Link>
            );
          })}
        </nav>
        <Link className="admin-store-link" href="/">Ver tienda</Link>
      </aside>
      <div className="admin-workspace">
        <header className="admin-topbar">
          <Link className="admin-mobile-brand" href="/admin/orders" aria-label="MileShop, inicio de administración">
            <Image src="/mileshop-logo.webp" alt="" width={40} height={40} />
          </Link>
          <p>Panel administrativo</p>
          <Link href="/">Ver tienda</Link>
        </header>
        <div className="admin-route-content" aria-busy={authorized === null}>
          {authorized === null ? (
            <div className="admin-route-loader" role="status">
              <span />
              <span />
              <span />
            </div>
          ) : children}
        </div>
      </div>
    </div>
  );
}
