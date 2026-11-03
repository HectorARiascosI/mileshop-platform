"use client";

import Link from "next/link";
import { useCallback, useEffect, useState } from "react";

import { getOrderStatusMessage, isOrderStatus } from "@/lib/order-presentation";

type OrderLine = {
  productId: string;
  sku: string;
  name: string;
  quantity: number;
  unitPriceCop: number;
};

type AdminOrder = {
  orderId: string;
  customerId: string;
  subtotalCop: number;
  deliveryFeeCop: number;
  totalCop: number;
  status: string;
  createdAt: string;
  reservationExpiresAt?: string | null;
  paymentReportedAt?: string | null;
  paymentReviewOverdue?: boolean;
  lines: OrderLine[];
};

type Product = {
  id: string;
  sku: string;
  name: string;
  priceCop: number;
  stock: number;
};

type SaleRequest = {
  idempotencyKey: string;
  productId: string;
  quantity: number;
};

type PendingOrderAction = {
  orderId: string;
  action: "confirm" | "cancel" | "reported";
};

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function isOrder(value: unknown): value is AdminOrder {
  return (
    isRecord(value) &&
    typeof value.orderId === "string" &&
    typeof value.customerId === "string" &&
    Number.isSafeInteger(value.subtotalCop) &&
    Number.isSafeInteger(value.deliveryFeeCop) &&
    Number.isSafeInteger(value.totalCop) &&
    typeof value.status === "string" &&
    typeof value.createdAt === "string" &&
    Number.isFinite(Date.parse(value.createdAt)) &&
    (value.reservationExpiresAt === undefined ||
      value.reservationExpiresAt === null ||
      (typeof value.reservationExpiresAt === "string" &&
        Number.isFinite(Date.parse(value.reservationExpiresAt)))) &&
    (value.paymentReportedAt === undefined ||
      value.paymentReportedAt === null ||
      (typeof value.paymentReportedAt === "string" &&
        Number.isFinite(Date.parse(value.paymentReportedAt)))) &&
    Array.isArray(value.lines) &&
    value.lines.every(
      (line) =>
        isRecord(line) &&
        typeof line.productId === "string" &&
        typeof line.sku === "string" &&
        typeof line.name === "string" &&
        Number.isSafeInteger(line.quantity) &&
        Number.isSafeInteger(line.unitPriceCop),
    )
  );
}

function isProduct(value: unknown): value is Product {
  return (
    isRecord(value) &&
    typeof value.id === "string" &&
    typeof value.sku === "string" &&
    typeof value.name === "string" &&
    Number.isSafeInteger(value.priceCop) &&
    Number.isSafeInteger(value.stock)
  );
}

function formatPrice(value: number): string {
  return new Intl.NumberFormat("es-CO", {
    style: "currency",
    currency: "COP",
    maximumFractionDigits: 0,
  }).format(value);
}

function formatDate(value: string): string {
  return new Intl.DateTimeFormat("es-CO", {
    dateStyle: "medium",
    timeStyle: "short",
  }).format(new Date(value));
}

function formatOrderStatus(status: string): string {
  return isOrderStatus(status)
    ? getOrderStatusMessage(status, null).title
    : "Estado por verificar";
}

async function responseError(response: Response, fallback: string): Promise<string> {
  try {
    const body: unknown = await response.json();
    if (isRecord(body)) {
      if (typeof body.message === "string") return body.message;
      if (typeof body.error === "string") return body.error;
    }
  } catch {
    return fallback;
  }
  return fallback;
}

export default function AdminOrdersPage() {
  const [authorized, setAuthorized] = useState<boolean>(true);
  const [orders, setOrders] = useState<AdminOrder[]>([]);
  const [products, setProducts] = useState<Product[]>([]);
  const [accessError, setAccessError] = useState<string | null>(null);
  const [selectedProductId, setSelectedProductId] = useState("");
  const [quantity, setQuantity] = useState("1");
  const [saleRequest, setSaleRequest] = useState<SaleRequest | null>(null);
  const [isLoading, setIsLoading] = useState(true);
  const [isSavingSale, setIsSavingSale] = useState(false);
  const [workingOrderId, setWorkingOrderId] = useState<string | null>(null);
  const [pendingOrderAction, setPendingOrderAction] = useState<PendingOrderAction | null>(null);
  const [cancellationReason, setCancellationReason] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);

  const refresh = useCallback(async () => {
    try {
      const [ordersResponse, productsResponse] = await Promise.all([
        fetch("/api/admin/orders", { cache: "no-store" }),
        fetch("/api/admin/catalog/products", { cache: "no-store" }),
      ]);
      if (ordersResponse.status === 401 || ordersResponse.status === 403) {
        setAuthorized(false);
        setAccessError(
          ordersResponse.status === 401
            ? "Inicia sesión con la cuenta de administradora de tienda."
            : "Tu cuenta no tiene permisos de administración de tienda.",
        );
        setOrders([]);
        return;
      }
      if (!ordersResponse.ok) {
        const upstreamMessage = await responseError(ordersResponse, "No se pudieron cargar los pedidos.");
        throw new Error(
          upstreamMessage === "Orders service is unavailable"
            ? "El módulo de pedidos está iniciando o no está disponible en este momento. Inténtalo de nuevo."
            : upstreamMessage,
        );
      }
      if (!productsResponse.ok) {
        throw new Error(await responseError(productsResponse, "No se pudo cargar el inventario."));
      }
      const ordersPayload: unknown = await ordersResponse.json();
      const productsPayload: unknown = await productsResponse.json();
      if (
        !isRecord(ordersPayload) ||
        !Array.isArray(ordersPayload.data) ||
        !isRecord(productsPayload) ||
        !Array.isArray(productsPayload.data)
      ) {
        throw new Error("El servicio devolvió datos de administración inválidos.");
      }
      const validOrders = ordersPayload.data.filter(isOrder);
      const validProducts = productsPayload.data.filter(isProduct);
      if (
        validOrders.length !== ordersPayload.data.length ||
        validProducts.length !== productsPayload.data.length
      ) {
        throw new Error("El servicio devolvió datos de administración inválidos.");
      }
      const now = Date.now();
      setOrders(
        validOrders.map((order) => ({
          ...order,
          paymentReviewOverdue:
            order.paymentReportedAt !== undefined &&
            order.paymentReportedAt !== null &&
            now - Date.parse(order.paymentReportedAt) > 24 * 60 * 60 * 1000,
        })),
      );
      setProducts(validProducts);
      setSelectedProductId((current) =>
        validProducts.some((product) => product.id === current)
          ? current
          : validProducts[0]?.id ?? "",
      );
    } catch (requestError) {
      setError(requestError instanceof Error ? requestError.message : "Error inesperado.");
    } finally {
      setIsLoading(false);
    }
  }, []);

  useEffect(() => {
    const timer = window.setTimeout(() => void refresh(), 0);
    return () => window.clearTimeout(timer);
  }, [refresh]);

  const decideOrder = async (
    orderId: string,
    decision: "confirm" | "cancel",
    reason?: string,
  ) => {
    setWorkingOrderId(orderId);
    setError(null);
    setNotice(null);
    try {
      const response = await fetch(`/api/admin/orders/${encodeURIComponent(orderId)}/${decision}`, {
        method: "POST",
        headers: decision === "cancel" ? { "content-type": "application/json" } : undefined,
        body: decision === "cancel" ? JSON.stringify({ reason }) : undefined,
      });
      if (!response.ok) {
        throw new Error(await responseError(response, "No se pudo actualizar el pedido."));
      }
      const payload: unknown = await response.json();
      if (!isRecord(payload) || !isRecord(payload.data) || typeof payload.data.result !== "string") {
        throw new Error("El servicio devolvió una decisión de pedido inválida.");
      }
      const successfulResults =
        decision === "confirm"
          ? ["approved", "already-approved"]
          : ["rejected", "already-rejected"];
      if (!successfulResults.includes(payload.data.result)) {
        throw new Error("El pedido ya no está pendiente. Actualiza la lista antes de intentar otra vez.");
      }
      setNotice(
        decision === "confirm"
          ? "Pago confirmado. La finalización de inventario quedó solicitada."
          : "Pedido cancelado. La liberación de inventario quedó solicitada.",
      );
      await refresh();
    } catch (requestError) {
      setError(requestError instanceof Error ? requestError.message : "Error inesperado.");
    } finally {
      setWorkingOrderId(null);
    }
  };

  const confirmOrder = (orderId: string) => {
    setPendingOrderAction({ orderId, action: "confirm" });
  };

  const cancelOrder = (orderId: string) => {
    setCancellationReason("");
    setPendingOrderAction({ orderId, action: "cancel" });
  };

  const markPaymentReported = async (orderId: string) => {
    setWorkingOrderId(orderId);
    setError(null);
    setNotice(null);
    try {
      const response = await fetch(
        `/api/admin/orders/${encodeURIComponent(orderId)}/payment-reported`,
        { method: "POST" },
      );
      if (!response.ok) {
        throw new Error(await responseError(response, "No se pudo registrar el pago informado."));
      }
      const payload: unknown = await response.json();
      if (
        !isRecord(payload) ||
        !isRecord(payload.data) ||
        !["marked", "already-reported"].includes(String(payload.data.result))
      ) {
        throw new Error("El pedido ya no admite registrar un pago informado.");
      }
      setNotice("Pago informado registrado. La reserva se mantiene mientras verificas la transferencia.");
      await refresh();
    } catch (requestError) {
      setError(requestError instanceof Error ? requestError.message : "Error inesperado.");
    } finally {
      setWorkingOrderId(null);
    }
  };

  const submitPendingOrderAction = async () => {
    if (!pendingOrderAction) return;
    if (pendingOrderAction.action === "cancel") {
      const reason = cancellationReason.trim();
      if (reason.length < 3) {
        setError("Escribe un motivo de cancelación de al menos 3 caracteres.");
        return;
      }
      await decideOrder(pendingOrderAction.orderId, "cancel", reason);
    } else if (pendingOrderAction.action === "confirm") {
      await decideOrder(pendingOrderAction.orderId, "confirm");
    } else {
      await markPaymentReported(pendingOrderAction.orderId);
    }
    setPendingOrderAction(null);
    setCancellationReason("");
  };

  const submitManualSale = async () => {
    let request = saleRequest;
    if (!request) {
      const parsedQuantity = Number(quantity);
      if (!selectedProductId || !Number.isSafeInteger(parsedQuantity) || parsedQuantity < 1) {
        setError("Selecciona un producto y una cantidad válida.");
        return;
      }
      request = {
        idempotencyKey: window.crypto.randomUUID(),
        productId: selectedProductId,
        quantity: parsedQuantity,
      };
      setSaleRequest(request);
    }
    setIsSavingSale(true);
    setError(null);
    setNotice(null);
    try {
      const response = await fetch("/api/admin/catalog/manual-sales", {
        method: "POST",
        headers: {
          "content-type": "application/json",
          "idempotency-key": request.idempotencyKey,
        },
        body: JSON.stringify({
          lines: [{ productId: request.productId, quantity: request.quantity }],
        }),
      });
      if (!response.ok) {
        throw new Error(await responseError(response, "No se pudo registrar la venta."));
      }
      setNotice("Venta manual registrada y descontada del inventario.");
      setQuantity("1");
      setSaleRequest(null);
      await refresh();
    } catch (requestError) {
      setError(requestError instanceof Error ? requestError.message : "Error inesperado.");
    } finally {
      setIsSavingSale(false);
    }
  };

  const selectedProduct = products.find((product) => product.id === selectedProductId);

  return (
    <main className="admin-console mx-auto min-h-screen max-w-5xl px-4 py-8 text-slate-900">
      <header className="admin-console-header mb-8 flex flex-wrap items-center justify-between gap-4">
        <div>
          <p className="admin-console-kicker text-sm font-semibold uppercase tracking-wide text-emerald-700">MileShop</p>
          <h1 className="text-3xl font-bold">Operaciones de tienda</h1>
          <p className="mt-1 text-slate-600">Pedidos de WhatsApp e inventario de ventas presenciales.</p>
        </div>
      </header>

      {authorized === false && (
        <section className="admin-access-card rounded-lg border border-amber-300 bg-amber-50 p-5">
          {accessError ?? "No se pudo autorizar la administración de la tienda."}
          <Link className="ml-2 font-semibold underline" href="/login">Iniciar sesión</Link>
        </section>
      )}
      {authorized && (
        <>
          <section className="admin-console-card mb-8 rounded-xl border bg-white p-5 shadow-sm">
            <div className="admin-console-card-heading">
              <div>
                <span>Acción rápida</span>
                <h2 className="text-xl font-semibold">Registrar venta manual</h2>
              </div>
              {selectedProduct && (
                <strong className="admin-stock-pill">
                  <span aria-hidden="true" />
                  Inventario: {selectedProduct.stock} unidades
                </strong>
              )}
            </div>
            <p className="mt-1 text-sm text-slate-600">
              Se descuenta del inventario disponible y queda un registro auditable de la operación.
            </p>
            <div className="mt-4 flex flex-wrap items-end gap-3">
              <label className="grid min-w-56 flex-1 gap-1 text-sm font-medium">
                Producto
                <select
                  className="rounded border px-3 py-2"
                  disabled={Boolean(saleRequest) || products.length === 0}
                  value={selectedProductId}
                  onChange={(event) => setSelectedProductId(event.target.value)}
                >
                  {products.map((product) => (
                    <option key={product.id} value={product.id}>
                      {product.name} — {product.stock} unidades disponibles
                    </option>
                  ))}
                </select>
              </label>
              <label className="grid w-28 gap-1 text-sm font-medium">
                Unidades
                <input
                  className="rounded border px-3 py-2"
                  type="number"
                  min="1"
                  max={selectedProduct?.stock ?? 1}
                  disabled={Boolean(saleRequest)}
                  value={quantity}
                  onChange={(event) => setQuantity(event.target.value)}
                />
              </label>
              <button
                className="rounded bg-emerald-700 px-4 py-2 font-semibold text-white disabled:opacity-50"
                disabled={isSavingSale || (!saleRequest && (!selectedProduct || selectedProduct.stock < 1))}
                onClick={() => void submitManualSale()}
                type="button"
              >
                {isSavingSale ? "Guardando..." : saleRequest ? "Reintentar registro" : "Registrar venta"}
              </button>
              {saleRequest && (
                <button
                  className="rounded border px-4 py-2"
                  disabled={isSavingSale}
                  onClick={() => setSaleRequest(null)}
                  type="button"
                >
                  Descartar reintento
                </button>
              )}
            </div>
            {selectedProduct && (
              <p className="mt-3 text-sm text-slate-600">
                Precio actual: {formatPrice(selectedProduct.priceCop)} · Inventario: {selectedProduct.stock} unidades
              </p>
            )}
          </section>

          <section className="admin-console-orders">
            <div className="mb-4 flex items-center justify-between gap-4">
              <div>
                <p className="admin-console-kicker text-sm font-semibold uppercase tracking-wide text-emerald-700">Cola operativa</p>
                <h2 className="text-xl font-semibold">Pedidos por revisar <span className="admin-order-count">{orders.length}</span></h2>
              </div>
              <button className="rounded border px-4 py-2 hover:bg-white" onClick={() => { setIsLoading(true); setError(null); void refresh(); }}>
                Actualizar
              </button>
            </div>
            {isLoading ? (
              <p className="text-slate-600">Cargando pedidos e inventario…</p>
            ) : orders.length === 0 ? (
              <p className="rounded-lg border bg-white p-5 text-slate-600">No hay pedidos pendientes.</p>
            ) : (
              <div className="space-y-4">
                {orders.map((order) => (
                  <article className="rounded-xl border bg-white p-5 shadow-sm" key={order.orderId}>
                    <div className="flex flex-wrap justify-between gap-3">
                      <div>
                        <h3 className="font-semibold">{order.orderId}</h3>
                        <p className="text-sm text-slate-600">
                          Cliente {order.customerId} · {formatDate(order.createdAt)}
                        </p>
                        <p className="mt-1 text-sm">Estado: {formatOrderStatus(order.status)}</p>
                        {order.paymentReportedAt ? (
                          <p className="mt-1 text-sm font-medium text-amber-800">
                            Pago informado {formatDate(order.paymentReportedAt)} · reserva protegida.
                            {order.paymentReviewOverdue
                              ? " Revisión pendiente hace más de 24 horas."
                              : " Verifica la transferencia y confirma o cancela el pedido."}
                          </p>
                        ) : (
                          <p className="mt-1 text-sm text-slate-600">
                            {order.reservationExpiresAt
                              ? `La reserva vence ${formatDate(order.reservationExpiresAt)} salvo que registres un pago informado.`
                              : "Pedido heredado sin vencimiento automático; verifica su estado antes de liberar la reserva."}
                          </p>
                        )}
                      </div>
                      <p className="text-lg font-bold">{formatPrice(order.totalCop)}</p>
                    </div>
                    <ul className="my-4 space-y-1 border-y py-3 text-sm">
                      {order.lines.map((line) => (
                        <li key={`${order.orderId}-${line.productId}`}>
                          {line.quantity} × {line.name} ({line.sku}) — {formatPrice(line.unitPriceCop * line.quantity)}
                        </li>
                      ))}
                    </ul>
                    <div className="flex flex-wrap gap-3">
                      {!order.paymentReportedAt && order.status === "AWAITING_PAYMENT_PROOF" && (
                        <button
                          className="rounded border border-amber-400 px-4 py-2 font-semibold text-amber-900 disabled:opacity-50"
                          disabled={workingOrderId === order.orderId}
                          onClick={() => setPendingOrderAction({ orderId: order.orderId, action: "reported" })}
                          type="button"
                        >
                          Marcar pago informado
                        </button>
                      )}
                      <button
                        className="rounded bg-emerald-700 px-4 py-2 font-semibold text-white disabled:opacity-50"
                        disabled={workingOrderId === order.orderId || order.status === "PAYMENT_APPROVED_FINALIZING"}
                        onClick={() => confirmOrder(order.orderId)}
                        type="button"
                      >
                        Confirmar pago verificado
                      </button>
                      <button
                        className="rounded border border-rose-300 px-4 py-2 font-semibold text-rose-800 disabled:opacity-50"
                        disabled={workingOrderId === order.orderId}
                        onClick={() => cancelOrder(order.orderId)}
                        type="button"
                      >
                        Cancelar y liberar reserva
                      </button>
                    </div>
                  </article>
                ))}
              </div>
            )}
          </section>
        </>
      )}
      {error && (
        <section className="admin-inline-alert" role="alert">
          <div>
            <strong>No pudimos cargar los pedidos</strong>
            <p>{error}</p>
          </div>
          <button type="button" onClick={() => { setIsLoading(true); setError(null); void refresh(); }} disabled={isLoading}>
            Reintentar
          </button>
        </section>
      )}
      {pendingOrderAction && (
        <div className="fixed inset-0 z-50 grid place-items-center bg-slate-950/50 p-4">
          <section
            aria-labelledby="order-action-title"
            aria-modal="true"
            className="w-full max-w-lg rounded-2xl bg-white p-6 shadow-2xl"
            role="dialog"
          >
            <p className="text-sm font-semibold uppercase tracking-wide text-emerald-800">Pedido</p>
            <h2 className="mt-2 text-xl font-bold" id="order-action-title">
              {pendingOrderAction.action === "cancel"
                ? "Cancelar pedido y liberar reserva"
                : pendingOrderAction.action === "confirm"
                  ? "Confirmar pago verificado"
                  : "Registrar pago informado"}
            </h2>
            <p className="mt-2 text-sm text-slate-600">
              {pendingOrderAction.action === "cancel"
                ? "La reserva se liberará. Deja el motivo para que quede registrado en el historial."
                : pendingOrderAction.action === "confirm"
                  ? "Confirma solo después de verificar el pago recibido por la tienda."
                  : "Esto registra que el cliente reportó el pago; no confirma que la transferencia haya sido verificada."}
            </p>
            {pendingOrderAction.action === "cancel" && (
              <label className="mt-5 grid gap-2 text-sm font-medium">
                Motivo de cancelación
                <textarea
                  autoFocus
                  className="min-h-24 rounded-lg border border-slate-300 px-3 py-2"
                  maxLength={500}
                  minLength={3}
                  onChange={(event) => setCancellationReason(event.target.value)}
                  placeholder="Ej.: pago no recibido"
                  required
                  value={cancellationReason}
                />
              </label>
            )}
            <div className="mt-6 flex flex-wrap justify-end gap-3">
              <button
                className="rounded-lg border border-slate-300 px-4 py-2 font-semibold"
                disabled={workingOrderId === pendingOrderAction.orderId}
                onClick={() => {
                  setPendingOrderAction(null);
                  setCancellationReason("");
                  setError(null);
                }}
                type="button"
              >
                Volver
              </button>
              <button
                className={`rounded-lg px-4 py-2 font-semibold text-white disabled:opacity-50 ${
                  pendingOrderAction.action === "cancel" ? "bg-rose-700" : "bg-emerald-700"
                }`}
                disabled={
                  workingOrderId === pendingOrderAction.orderId ||
                  (pendingOrderAction.action === "cancel" && cancellationReason.trim().length < 3)
                }
                onClick={() => void submitPendingOrderAction()}
                type="button"
              >
                {workingOrderId === pendingOrderAction.orderId
                  ? "Procesando..."
                  : pendingOrderAction.action === "cancel"
                    ? "Cancelar pedido"
                    : pendingOrderAction.action === "confirm"
                      ? "Confirmar pago"
                      : "Registrar pago informado"}
              </button>
            </div>
          </section>
        </div>
      )}
      {notice && <p className="mt-5 rounded border border-emerald-300 bg-emerald-50 p-3 text-emerald-800" role="status">{notice}</p>}
    </main>
  );
}
