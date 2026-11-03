"use client";

import Link from "next/link";
import { useParams } from "next/navigation";
import { useCallback, useEffect, useState } from "react";

import {
  getOrderStatusMessage,
  isOrderStatus,
  isPaymentDecisionForStatus,
  type OrderStatus,
  type PaymentDecision,
} from "@/lib/order-presentation";

type OrderLine = {
  id: string;
  name: string;
  sku: string;
  quantity: number;
  unitPriceCop: number;
};
type CancellationRequest = {
  requestedAt: string;
  resolvedAt: string | null;
  resolution: "CANCELLED" | "KEPT_OPEN" | null;
};
type OrderDetail = {
  orderId: string;
  subtotalCop: number;
  deliveryFeeCop: number;
  totalCop: number;
  status: OrderStatus;
  reservationExpiresAt: string | null;
  createdAt: string;
  lines: OrderLine[];
  paymentDecision: PaymentDecision | null;
  cancellationRequest: CancellationRequest | null;
};
type OrderLoadResult =
  | { order: OrderDetail }
  | { error: string; requiresLogin: boolean };

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function isValidDate(value: unknown): value is string {
  return typeof value === "string" && Number.isFinite(Date.parse(value));
}

function isSafeInteger(value: unknown): value is number {
  return typeof value === "number" && Number.isSafeInteger(value);
}

function isOrderLine(value: unknown): value is OrderLine {
  return (
    isRecord(value) &&
    typeof value.id === "string" &&
    typeof value.name === "string" &&
    typeof value.sku === "string" &&
    isSafeInteger(value.quantity) &&
    value.quantity > 0 &&
    isSafeInteger(value.unitPriceCop) &&
    value.unitPriceCop >= 0
  );
}

function isCancellationRequest(value: unknown): value is CancellationRequest | null {
  if (value === null) {
    return true;
  }
  if (
    !isRecord(value) ||
    !isValidDate(value.requestedAt) ||
    (value.resolvedAt !== null && !isValidDate(value.resolvedAt)) ||
    (value.resolution !== null &&
      value.resolution !== "CANCELLED" &&
      value.resolution !== "KEPT_OPEN")
  ) {
    return false;
  }
  return (value.resolvedAt === null) === (value.resolution === null);
}

function parseOrder(value: unknown): OrderDetail | null {
  if (!isRecord(value) || !isRecord(value.data)) {
    return null;
  }
  const order = value.data;
  if (
    typeof order.orderId !== "string" ||
    !isSafeInteger(order.subtotalCop) ||
    !isSafeInteger(order.deliveryFeeCop) ||
    !isSafeInteger(order.totalCop) ||
    !isOrderStatus(order.status) ||
    (order.reservationExpiresAt !== null && !isValidDate(order.reservationExpiresAt)) ||
    !isValidDate(order.createdAt) ||
    !Array.isArray(order.lines) ||
    !order.lines.every(isOrderLine) ||
    !isPaymentDecisionForStatus(order.paymentDecision, order.status) ||
    !isCancellationRequest(order.cancellationRequest)
  ) {
    return null;
  }

  return {
    orderId: order.orderId,
    subtotalCop: order.subtotalCop,
    deliveryFeeCop: order.deliveryFeeCop,
    totalCop: order.totalCop,
    status: order.status,
    reservationExpiresAt: order.reservationExpiresAt,
    createdAt: order.createdAt,
    lines: order.lines,
    paymentDecision: order.paymentDecision,
    cancellationRequest: order.cancellationRequest,
  };
}

async function requestOrderDetail(orderId: string): Promise<OrderLoadResult> {
  try {
    const response = await fetch(
      `/api/orders/${encodeURIComponent(orderId)}`,
      { cache: "no-store" },
    );
    if (response.status === 401) {
      return {
        error: "Inicia sesión para consultar este pedido.",
        requiresLogin: true,
      };
    }
    if (response.status === 404) {
      return {
        error: "No encontramos este pedido en tu cuenta.",
        requiresLogin: false,
      };
    }
    if (!response.ok) {
      return {
        error: "No pudimos consultar el pedido. Inténtalo de nuevo.",
        requiresLogin: false,
      };
    }
    const parsed = parseOrder(await response.json());
    if (!parsed || parsed.orderId !== orderId) {
      return {
        error: "El servicio devolvió información de pedido inválida.",
        requiresLogin: false,
      };
    }
    return { order: parsed };
  } catch {
    return {
      error: "No pudimos consultar el pedido. Inténtalo de nuevo.",
      requiresLogin: false,
    };
  }
}

function formatPrice(priceCop: number): string {
  return new Intl.NumberFormat("es-CO", {
    style: "currency",
    currency: "COP",
    maximumFractionDigits: 0,
  }).format(priceCop);
}

function formatDate(value: string): string {
  return new Intl.DateTimeFormat("es-CO", {
    dateStyle: "long",
    timeStyle: "short",
  }).format(new Date(value));
}

export default function OrderPage() {
  const { orderId } = useParams<{ orderId: string }>();
  const [order, setOrder] = useState<OrderDetail | null>(null);
  const [isLoading, setIsLoading] = useState(true);
  const [isRefreshing, setIsRefreshing] = useState(false);
  const [isCancelling, setIsCancelling] = useState(false);
  const [isRequestingCancellation, setIsRequestingCancellation] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [requiresLogin, setRequiresLogin] = useState(false);

  const applyOrderLoadResult = useCallback((result: OrderLoadResult) => {
    if ("order" in result) {
      setOrder(result.order);
      setRequiresLogin(false);
      setError(null);
    } else {
      if (result.requiresLogin) {
        setRequiresLogin(true);
      }
      setError(result.error);
    }
    setIsLoading(false);
  }, []);

  const loadOrder = useCallback(async (showRefreshing = false) => {
    if (showRefreshing) {
      setIsRefreshing(true);
    }
    applyOrderLoadResult(await requestOrderDetail(orderId));
    if (showRefreshing) {
      setIsRefreshing(false);
    }
  }, [applyOrderLoadResult, orderId]);

  const cancelOrder = useCallback(async () => {
    if (!window.confirm("¿Deseas cancelar este pedido y liberar la reserva?")) {
      return;
    }

    setIsCancelling(true);
    setError(null);
    try {
      const response = await fetch(
        `/api/orders/${encodeURIComponent(orderId)}/cancel`,
        { method: "POST", cache: "no-store" },
      );
      if (response.status === 401) {
        setRequiresLogin(true);
        throw new Error("Inicia sesión para cancelar este pedido.");
      }
      if (response.status === 404) {
        throw new Error("No encontramos este pedido en tu cuenta.");
      }
      if (response.status === 409) {
        throw new Error(
          "El pedido ya no se puede cancelar: el comprobante pudo haberse enviado o la reserva venció.",
        );
      }
      if (!response.ok) {
        throw new Error("No pudimos cancelar el pedido. Inténtalo de nuevo.");
      }
      const result: unknown = await response.json();
      const parsed = parseOrder(result);
      if (
        !parsed ||
        parsed.orderId !== orderId ||
        parsed.status !== "CANCELLED" ||
        parsed.paymentDecision !== null
      ) {
        throw new Error("El servicio devolvió una cancelación inválida.");
      }
      setOrder(parsed);
      setRequiresLogin(false);
    } catch (cancelError) {
      setError(
        cancelError instanceof Error
          ? cancelError.message
          : "No pudimos cancelar el pedido. Inténtalo de nuevo.",
      );
    } finally {
      setIsCancelling(false);
    }
  }, [orderId]);

  const requestCancellation = useCallback(async () => {
    if (
      !window.confirm(
        "¿Solicitas cancelar este pedido? La solicitud no libera la reserva; el equipo administrativo debe resolverla.",
      )
    ) {
      return;
    }

    setIsRequestingCancellation(true);
    setError(null);
    try {
      const response = await fetch(
        `/api/orders/${encodeURIComponent(orderId)}/cancellation-request`,
        { method: "POST", cache: "no-store" },
      );
      if (response.status === 401) {
        setRequiresLogin(true);
        throw new Error("Inicia sesión para solicitar la cancelación.");
      }
      if (response.status === 404) {
        throw new Error("No encontramos este pedido en tu cuenta.");
      }
      if (response.status === 409) {
        throw new Error("Este pedido ya no admite solicitudes de cancelación.");
      }
      if (!response.ok) {
        throw new Error("No pudimos enviar la solicitud. Inténtalo de nuevo.");
      }
      const parsed = parseOrder(await response.json());
      if (
        !parsed ||
        parsed.orderId !== orderId ||
        parsed.status !== "PAYMENT_REVIEW_PENDING" ||
        !parsed.cancellationRequest ||
        parsed.cancellationRequest.resolvedAt !== null
      ) {
        throw new Error("El servicio devolvió una solicitud de cancelación inválida.");
      }
      setOrder(parsed);
      setRequiresLogin(false);
    } catch (requestError) {
      setError(
        requestError instanceof Error
          ? requestError.message
          : "No pudimos enviar la solicitud. Inténtalo de nuevo.",
      );
    } finally {
      setIsRequestingCancellation(false);
    }
  }, [orderId]);

  useEffect(() => {
    let active = true;
    void requestOrderDetail(orderId).then((result) => {
      if (active) {
        applyOrderLoadResult(result);
      }
    });
    return () => {
      active = false;
    };
  }, [applyOrderLoadResult, orderId]);

  useEffect(() => {
    if (
      !order ||
      (order.paymentDecision && order.status !== "PAYMENT_APPROVED_FINALIZING") ||
      order.status === "CONFIRMED" ||
      order.status === "RESERVATION_EXPIRED" ||
      order.status === "RESERVATION_FAILED" ||
      order.status === "CANCELLED"
    ) {
      return;
    }
    const timer = window.setInterval(() => void loadOrder(), 5_000);
    return () => window.clearInterval(timer);
  }, [loadOrder, order]);

  if (isLoading) {
    return (
      <main className="checkout-page">
        <section className="checkout-card" aria-live="polite">
          <p className="eyebrow">Pedido</p>
          <h1>Consultando el estado de tu pedido…</h1>
        </section>
      </main>
    );
  }

  if (!order) {
    return (
      <main className="checkout-page">
        <section className="checkout-card">
          <p className="eyebrow">Pedido</p>
          <h1>No pudimos mostrar tu pedido</h1>
          <p role="alert">{error}</p>
          {requiresLogin ? (
            <Link className="checkout-button order-action" href="/login">Iniciar sesión</Link>
          ) : (
            <button className="checkout-button order-action" type="button" onClick={() => void loadOrder()}>
              Intentar de nuevo
            </button>
          )}
        </section>
      </main>
    );
  }

  const decision = order.paymentDecision;
  const { title: statusTitle, description: statusDescription } = getOrderStatusMessage(
    order.status,
    decision,
  );

  return (
    <main className="checkout-page">
      <section className="checkout-card order-detail-card">
        <p className="eyebrow">Seguimiento de pedido</p>
        <h1>{statusTitle}</h1>
        <p className="order-status-description">{statusDescription}</p>

        <div className="order-meta">
          <span>Número de pedido</span>
          <strong>{order.orderId}</strong>
        </div>

        {order.reservationExpiresAt && (
          <div className="order-meta">
            <span>Vencimiento de la reserva</span>
            <strong>{formatDate(order.reservationExpiresAt)}</strong>
          </div>
        )}

        {decision && (
          <section className={`order-decision ${decision.decision === "REJECTED" ? "notice-error" : "notice-success"}`}>
            <strong>
              {decision.decision === "APPROVED" ? "Pago aprobado" : "Pago rechazado"}
            </strong>
            <span>Revisado el {formatDate(decision.decidedAt)}</span>
            {decision.decision === "REJECTED" && (
              <p><strong>Motivo del rechazo:</strong> {decision.reason}</p>
            )}
          </section>
        )}

        {order.cancellationRequest && (
          <section className="order-decision" aria-live="polite">
            <strong>
              {order.cancellationRequest.resolution === "KEPT_OPEN"
                ? "Solicitud revisada: el pedido sigue abierto"
                : order.cancellationRequest.resolution === "CANCELLED"
                  ? "Solicitud de cancelación resuelta"
                  : "Solicitud de cancelación en revisión"}
            </strong>
            <span>Solicitada el {formatDate(order.cancellationRequest.requestedAt)}</span>
            {order.cancellationRequest.resolvedAt && (
              <span>Resuelta el {formatDate(order.cancellationRequest.resolvedAt)}</span>
            )}
            {order.cancellationRequest.resolution === null && (
              <p>La reserva se mantiene activa mientras el equipo revisa la solicitud.</p>
            )}
            {order.cancellationRequest.resolution === "KEPT_OPEN" && (
              <p>El pedido permanece en revisión de pago; no se liberó la reserva.</p>
            )}
            {order.cancellationRequest.resolution === "CANCELLED" && (
              <p>
                La cancelación fue resuelta por administración. Cualquier reembolso se gestiona fuera de MileShop.
              </p>
            )}
          </section>
        )}

        {error && <p className="order-refresh-error" role="status">{error}</p>}

        <ul className="order-lines">
          {order.lines.map((line) => (
            <li key={line.id}>
              <div>
                <strong>{line.name}</strong>
                <span>{line.quantity} x {formatPrice(line.unitPriceCop)}</span>
              </div>
              <strong>{formatPrice(line.quantity * line.unitPriceCop)}</strong>
            </li>
          ))}
        </ul>

        <div className="checkout-summary checkout-summary-inline">
          <div>
            <span>Subtotal</span>
            <strong>{formatPrice(order.subtotalCop)}</strong>
          </div>
          <div>
            <span>Envío</span>
            <strong>{order.deliveryFeeCop === 0 ? "Gratis" : formatPrice(order.deliveryFeeCop)}</strong>
          </div>
          <div className="checkout-total">
            <span>Total</span>
            <strong>{formatPrice(order.totalCop)}</strong>
          </div>
        </div>

        <button
          className="checkout-button order-action"
          type="button"
          onClick={() => void loadOrder(true)}
          disabled={isRefreshing}
        >
          {isRefreshing ? "Actualizando…" : "Actualizar estado"}
        </button>
        {order.status === "AWAITING_PAYMENT_PROOF" && (
          <button
            className="checkout-button order-action"
            type="button"
            onClick={() => void cancelOrder()}
            disabled={isCancelling || isRefreshing}
          >
            {isCancelling ? "Cancelando…" : "Cancelar pedido"}
          </button>
        )}
        {order.status === "PAYMENT_REVIEW_PENDING" && !order.cancellationRequest && (
          <button
            className="checkout-button order-action"
            type="button"
            onClick={() => void requestCancellation()}
            disabled={isRequestingCancellation || isRefreshing}
          >
            {isRequestingCancellation ? "Enviando solicitud…" : "Solicitar cancelación"}
          </button>
        )}
        <Link className="order-back-link" href="/">Volver al catálogo</Link>
      </section>
    </main>
  );
}
