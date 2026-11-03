"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { useEffect, useState, type ReactNode } from "react";

const navigation = [
  { href: "/admin/orders", label: "Pedidos", short: "Pedidos" },
  { href: "/admin/catalog", label: "Catálogo", short: "Catálogo" },
  { href: "/admin/catalog/promotions", label: "Promociones", short: "Oferta" },
  { href: "/admin/catalog/announcements", label: "Anuncios", short: "Avisos" },
  { href: "/admin/payments", label: "Pagos", short: "Pagos" },
];

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
          <span className="admin-access-mark" aria-hidden="true">M</span>
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
          <span aria-hidden="true">M</span>
          <strong>MileShop</strong>
        </Link>
        <nav>
          {navigation.map((item) => {
            const active = pathname === item.href || pathname.startsWith(`${item.href}/`);
            return (
              <Link
                key={item.href}
                href={item.href}
                aria-current={active ? "page" : undefined}
                className={active ? "is-active" : undefined}
              >
                <span className="admin-nav-short" aria-hidden="true">{item.short.slice(0, 1)}</span>
                <span>{item.label}</span>
              </Link>
            );
          })}
        </nav>
        <Link className="admin-store-link" href="/">Ver tienda</Link>
      </aside>
      <div className="admin-workspace">
        <header className="admin-topbar">
          <Link className="admin-mobile-brand" href="/admin/orders">MileShop</Link>
          <p>Panel administrativo</p>
          <Link href="/login?next=/admin/orders">Cuenta</Link>
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
