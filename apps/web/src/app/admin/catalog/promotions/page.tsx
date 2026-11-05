"use client";

import Link from "next/link";
import { useCallback, useEffect, useState, type FormEvent } from "react";

import type { CatalogPromotion, CatalogPromotionInput } from "@mileshop/contracts";
import { AdminConfirmDialog } from "@/components/admin-confirm-dialog";

type Product = { id: string; sku: string; name: string; priceCop: number; isActive: boolean };
type ProductDiscounts = Record<string, string>;

const localDateTime = (date: Date) => {
  const adjusted = new Date(date.getTime() - date.getTimezoneOffset() * 60_000);
  return adjusted.toISOString().slice(0, 16);
};

function blankForm(): CatalogPromotionInput {
  const startsAt = new Date();
  const endsAt = new Date(startsAt.getTime() + 7 * 24 * 60 * 60 * 1000);
  return {
    title: "",
    description: "",
    startsAt: localDateTime(startsAt),
    endsAt: localDateTime(endsAt),
    isActive: true,
    products: [],
  };
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

async function responseError(response: Response): Promise<string> {
  try {
    const body: unknown = await response.json();
    if (isRecord(body) && typeof body.message === "string") return body.message;
    if (isRecord(body) && typeof body.error === "string") return body.error;
  } catch {
    return "No se pudo completar la solicitud.";
  }
  return "No se pudo completar la solicitud.";
}

function isProduct(value: unknown): value is Product {
  return isRecord(value) &&
    typeof value.id === "string" &&
    typeof value.sku === "string" &&
    typeof value.name === "string" &&
    Number.isSafeInteger(value.priceCop) &&
    typeof value.isActive === "boolean";
}

function isPromotion(value: unknown): value is CatalogPromotion {
  return isRecord(value) &&
    typeof value.id === "string" &&
    typeof value.title === "string" &&
    typeof value.description === "string" &&
    typeof value.startsAt === "string" &&
    typeof value.endsAt === "string" &&
    typeof value.isActive === "boolean" &&
    Array.isArray(value.products) &&
    value.products.every((product) =>
      isRecord(product) &&
      typeof product.productId === "string" &&
      typeof product.name === "string" &&
      typeof product.sku === "string" &&
      Number.isSafeInteger(product.discountPercent),
    );
}

function formatPrice(priceCop: number): string {
  return new Intl.NumberFormat("es-CO", {
    style: "currency",
    currency: "COP",
    maximumFractionDigits: 0,
  }).format(priceCop);
}

export default function AdminPromotionsPage() {
  const [authorized, setAuthorized] = useState<boolean>(true);
  const [products, setProducts] = useState<Product[]>([]);
  const [promotions, setPromotions] = useState<CatalogPromotion[]>([]);
  const [form, setForm] = useState<CatalogPromotionInput>(blankForm);
  const [discounts, setDiscounts] = useState<ProductDiscounts>({});
  const [editingId, setEditingId] = useState<string | null>(null);
  const [pendingDelete, setPendingDelete] = useState<CatalogPromotion | null>(null);
  const [busy, setBusy] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);

  const refresh = useCallback(async () => {
    try {
      const [productsResponse, promotionsResponse] = await Promise.all([
        fetch("/api/admin/catalog/products", { cache: "no-store" }),
        fetch("/api/admin/catalog/promotions", { cache: "no-store" }),
      ]);
      if (productsResponse.status === 401 || productsResponse.status === 403 ||
          promotionsResponse.status === 401 || promotionsResponse.status === 403) {
        setAuthorized(false);
        return;
      }
      if (!productsResponse.ok) throw new Error(await responseError(productsResponse));
      if (!promotionsResponse.ok) throw new Error(await responseError(promotionsResponse));
      const productsPayload: unknown = await productsResponse.json();
      const promotionsPayload: unknown = await promotionsResponse.json();
      if (!isRecord(productsPayload) || !Array.isArray(productsPayload.data) ||
          !isRecord(promotionsPayload) || !Array.isArray(promotionsPayload.data)) {
        throw new Error("El servicio devolvió datos de promociones inválidos.");
      }
      const nextProducts = productsPayload.data.filter(isProduct);
      const nextPromotions = promotionsPayload.data.filter(isPromotion);
      if (nextProducts.length !== productsPayload.data.length ||
          nextPromotions.length !== promotionsPayload.data.length) {
        throw new Error("El servicio devolvió datos de promociones inválidos.");
      }
      setProducts(nextProducts);
      setPromotions(nextPromotions);
    } catch (requestError) {
      setError(requestError instanceof Error ? requestError.message : "Error inesperado.");
    } finally {
      setBusy(false);
    }
  }, []);

  useEffect(() => {
    const timer = window.setTimeout(() => void refresh(), 0);
    return () => window.clearTimeout(timer);
  }, [refresh]);

  const reset = () => {
    setForm(blankForm());
    setDiscounts({});
    setEditingId(null);
  };

  const beginEdit = (promotion: CatalogPromotion) => {
    setEditingId(promotion.id);
    setForm({
      title: promotion.title,
      description: promotion.description,
      startsAt: localDateTime(new Date(promotion.startsAt)),
      endsAt: localDateTime(new Date(promotion.endsAt)),
      isActive: promotion.isActive,
      products: [],
    });
    setDiscounts(Object.fromEntries(
      promotion.products.map((product) => [product.productId, String(product.discountPercent)]),
    ));
    setError(null);
    setNotice(null);
  };

  const save = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    const selected = Object.entries(discounts)
      .filter(([, discount]) => discount !== "")
      .map(([productId, discount]) => ({ productId, discountPercent: Number(discount) }));
    if (selected.length === 0) {
      setError("Selecciona al menos un producto e indica su descuento.");
      return;
    }
    if (selected.some(({ discountPercent }) =>
      !Number.isSafeInteger(discountPercent) || discountPercent < 1 || discountPercent > 90,
    )) {
      setError("Cada descuento debe ser un número entero entre 1 % y 90 %.");
      return;
    }
    setBusy(true);
    setError(null);
    setNotice(null);
    try {
      const input: CatalogPromotionInput = {
        ...form,
        startsAt: new Date(form.startsAt).toISOString(),
        endsAt: new Date(form.endsAt).toISOString(),
        products: selected,
      };
      const response = await fetch(
        editingId
          ? `/api/admin/catalog/promotions/${encodeURIComponent(editingId)}`
          : "/api/admin/catalog/promotions",
        {
          method: editingId ? "PATCH" : "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify(input),
        },
      );
      if (!response.ok) throw new Error(await responseError(response));
      const payload: unknown = await response.json();
      if (!isRecord(payload) || !isPromotion(payload.data)) {
        throw new Error("El servicio devolvió una promoción inválida.");
      }
      setNotice(editingId ? "Promoción actualizada." : "Promoción creada.");
      reset();
      await refresh();
    } catch (requestError) {
      setError(requestError instanceof Error ? requestError.message : "Error inesperado.");
    } finally {
      setBusy(false);
    }
  };

  const remove = async (promotion: CatalogPromotion) => {
    setBusy(true);
    setError(null);
    setNotice(null);
    try {
      const response = await fetch(`/api/admin/catalog/promotions/${encodeURIComponent(promotion.id)}`, {
        method: "DELETE",
      });
      if (!response.ok) throw new Error(await responseError(response));
      if (editingId === promotion.id) reset();
      setNotice("Promoción eliminada.");
      await refresh();
    } catch (requestError) {
      setError(requestError instanceof Error ? requestError.message : "Error inesperado.");
    } finally {
      setBusy(false);
    }
  };

  return (
    <main className="mx-auto min-h-screen max-w-6xl px-4 py-8 text-slate-900">
      <header className="admin-console-header mb-8 flex flex-wrap items-center justify-between gap-4">
        <div>
          <p className="text-sm font-semibold uppercase tracking-wide text-emerald-700">MileShop</p>
          <h1 className="text-3xl font-bold">Promociones y descuentos</h1>
          <p className="mt-1 text-slate-600">Crea campañas con precio rebajado real, vigencia y productos específicos.</p>
        </div>
      </header>

      {authorized === false && (
        <section className="rounded-lg border border-amber-300 bg-amber-50 p-5">
          Inicia sesión con la cuenta de administradora de tienda. <Link className="font-semibold underline" href="/login">Iniciar sesión</Link>
        </section>
      )}
      {authorized && (
        <>
          {error && <p className="mb-4 rounded-lg bg-red-50 p-3 text-red-800" role="alert">{error}</p>}
          {notice && <p className="mb-4 rounded-lg bg-emerald-50 p-3 text-emerald-800" role="status">{notice}</p>}
          <section className="grid gap-6 lg:grid-cols-[minmax(0,1fr)_minmax(0,1fr)]">
            <form className="grid content-start gap-4 rounded-xl border bg-white p-5 shadow-sm" onSubmit={save}>
              <div>
                <h2 className="text-xl font-semibold">{editingId ? "Editar promoción" : "Nueva promoción"}</h2>
                <p className="mt-1 text-sm text-slate-600">Los descuentos del 1 % al 90 % se validan y aplican en el servidor al reservar el pedido.</p>
              </div>
              <label className="grid gap-1 text-sm font-medium">Nombre de la campaña
                <input className="rounded border px-3 py-2" required minLength={3} maxLength={100} value={form.title} onChange={(event) => setForm({ ...form, title: event.target.value })} />
              </label>
              <label className="grid gap-1 text-sm font-medium">Descripción
                <textarea className="rounded border px-3 py-2" maxLength={1000} rows={3} value={form.description} onChange={(event) => setForm({ ...form, description: event.target.value })} />
              </label>
              <div className="grid gap-3 sm:grid-cols-2">
                <label className="grid gap-1 text-sm font-medium">Empieza
                  <input className="rounded border px-3 py-2" type="datetime-local" required value={form.startsAt} onChange={(event) => setForm({ ...form, startsAt: event.target.value })} />
                </label>
                <label className="grid gap-1 text-sm font-medium">Termina
                  <input className="rounded border px-3 py-2" type="datetime-local" required value={form.endsAt} onChange={(event) => setForm({ ...form, endsAt: event.target.value })} />
                </label>
              </div>
              <fieldset className="grid gap-2">
                <legend className="mb-1 text-sm font-semibold">Productos y descuentos</legend>
                {products.length === 0 ? <p className="text-sm text-slate-600">Primero agrega productos al catálogo.</p> : products.map((product) => (
                  <label className="flex flex-wrap items-center gap-3 rounded border p-3 text-sm" key={product.id}>
                    <input
                      type="checkbox"
                      checked={discounts[product.id] !== undefined}
                      onChange={(event) => setDiscounts((current) => {
                        const next = { ...current };
                        if (event.target.checked) next[product.id] = "10";
                        else delete next[product.id];
                        return next;
                      })}
                    />
                    <span className="min-w-40 flex-1">{product.name} <span className="text-slate-500">({formatPrice(product.priceCop)})</span>{!product.isActive && <span className="ml-1 text-amber-700">— desactivado</span>}</span>
                    {discounts[product.id] !== undefined && (
                      <span className="flex items-center gap-2">
                        <input
                          className="w-20 rounded border px-2 py-1"
                          aria-label={`Descuento de ${product.name} en porcentaje`}
                          type="number"
                          min={1}
                          max={90}
                          step={1}
                          required
                          value={discounts[product.id]}
                          onChange={(event) => setDiscounts((current) => ({ ...current, [product.id]: event.target.value }))}
                        />
                        <span>%</span>
                      </span>
                    )}
                  </label>
                ))}
              </fieldset>
              <label className="flex items-center gap-2 text-sm font-medium">
                <input type="checkbox" checked={form.isActive} onChange={(event) => setForm({ ...form, isActive: event.target.checked })} />
                Campaña activa durante la vigencia indicada
              </label>
              <div className="flex flex-wrap gap-2">
                <button className="rounded bg-slate-900 px-4 py-2 font-semibold text-white disabled:opacity-50" type="submit" disabled={busy}>
                  {busy ? "Guardando…" : editingId ? "Guardar cambios" : "Crear promoción"}
                </button>
                {editingId && <button className="rounded border px-4 py-2 font-medium" type="button" onClick={reset}>Cancelar edición</button>}
              </div>
            </form>

            <section className="rounded-xl border bg-white p-5 shadow-sm" aria-labelledby="promotion-list-title">
              <div className="mb-4 flex items-center justify-between gap-3">
                <div>
                  <h2 className="text-xl font-semibold" id="promotion-list-title">Campañas</h2>
                  <p className="text-sm text-slate-600">{promotions.length} registradas, incluidas las inactivas.</p>
                </div>
                <button className="rounded border px-3 py-2 text-sm font-medium" type="button" onClick={() => { setBusy(true); setError(null); void refresh(); }} disabled={busy}>Actualizar</button>
              </div>
              {promotions.length === 0 ? <p className="rounded bg-slate-50 p-4 text-slate-600">Aún no hay promociones.</p> : (
                <ul className="grid gap-3">
                  {promotions.map((promotion) => (
                    <li className="rounded-lg border p-4" key={promotion.id}>
                      <div className="flex flex-wrap items-start justify-between gap-3">
                        <div>
                          <h3 className="font-semibold">{promotion.title}</h3>
                          <p className="text-sm text-slate-600">{new Date(promotion.startsAt).toLocaleString("es-CO")} – {new Date(promotion.endsAt).toLocaleString("es-CO")}</p>
                          <p className="mt-1 text-xs font-semibold uppercase tracking-wide">{promotion.isActive ? "Activa" : "Desactivada"}</p>
                        </div>
                        <div className="flex gap-2">
                          <button className="rounded border px-3 py-1.5 text-sm" type="button" onClick={() => beginEdit(promotion)}>Editar</button>
                          <button className="rounded border border-red-300 px-3 py-1.5 text-sm text-red-700" type="button" disabled={busy} onClick={() => setPendingDelete(promotion)}>Eliminar</button>
                        </div>
                      </div>
                      {promotion.description && <p className="mt-2 text-sm text-slate-700">{promotion.description}</p>}
                      <ul className="mt-3 grid gap-1 text-sm">
                        {promotion.products.map((product) => <li key={product.productId}>{product.name} ({product.sku}) — {product.discountPercent}%</li>)}
                      </ul>
                    </li>
                  ))}
                </ul>
              )}
            </section>
          </section>
        </>
      )}
      {pendingDelete && (
        <AdminConfirmDialog
          title="Eliminar promoción"
          message={`La campaña «${pendingDelete.title}» dejará de aplicarse a los pedidos futuros.`}
          confirmLabel="Eliminar promoción"
          busy={busy}
          onCancel={() => setPendingDelete(null)}
          onConfirm={() => {
            const promotion = pendingDelete;
            setPendingDelete(null);
            void remove(promotion);
          }}
        />
      )}
    </main>
  );
}
