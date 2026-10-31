"use client";

import { useEffect, useState } from "react";

import { buildWhatsAppOrderUrl } from "@/lib/whatsapp-order";

type OrderStatus = "PENDING" | "CONFIRMED" | "CANCELLED";

type CheckoutOrderData = {
  orderId: string;
  subtotalCop: number;
  deliveryFeeCop: number;
  totalCop: number;
  status: OrderStatus;
  createdAt: string;
  lines: Array<{
    productId: string;
    sku: string;
    name: string;
    quantity: number;
    unitPriceCop: number;
  }>;
};

type CheckoutOrderProps = {
  orderId: string | null;
};

const WHATSAPP_BUSINESS_PHONE = process.env.NEXT_PUBLIC_WHATSAPP_BUSINESS_PHONE;

function formatPrice(priceCop: number): string {
  return new Intl.NumberFormat("es-CO", {
    style: "currency",
    currency: "COP",
    maximumFractionDigits: 0,
  }).format(priceCop);
}

function isCheckoutOrder(value: unknown): value is CheckoutOrderData {
  if (!value || typeof value !== "object") {
    return false;
  }

  const order = value as Partial<CheckoutOrderData>;
  return (
    typeof order.orderId === "string" &&
    typeof order.subtotalCop === "number" &&
    typeof order.deliveryFeeCop === "number" &&
    typeof order.totalCop === "number" &&
    (order.status === "PENDING" || order.status === "CONFIRMED" || order.status === "CANCELLED") &&
    typeof order.createdAt === "string" &&
    Array.isArray(order.lines) &&
    order.lines.every((line) =>
      line !== null &&
      typeof line === "object" &&
      typeof line.productId === "string" &&
      typeof line.sku === "string" &&
      typeof line.name === "string" &&
      Number.isInteger(line.quantity) &&
      Number.isInteger(line.unitPriceCop),
    )
  );
}

function statusLabel(status: OrderStatus): string {
  switch (status) {
    case "PENDING":
      return "Recibido; pendiente de procesamiento";
    case "CONFIRMED":
      return "Confirmado";
    case "CANCELLED":
      return "Cancelado";
  }
}

export function CheckoutOrder({ orderId }: CheckoutOrderProps) {
  const [order, setOrder] = useState<CheckoutOrderData | null>(null);
  const [isLoading, setIsLoading] = useState(Boolean(orderId));
  const [statusUnavailable, setStatusUnavailable] = useState(false);
  const [notFound, setNotFound] = useState(false);
  const [refreshKey, setRefreshKey] = useState(0);
  const whatsAppUrl = order
    ? buildWhatsAppOrderUrl(WHATSAPP_BUSINESS_PHONE, order)
    : null;

  useEffect(() => {
    if (!orderId) {
      return;
    }

    let active = true;
    void fetch(`/api/orders/${encodeURIComponent(orderId)}`)
      .then(async (response) => {
        if (response.status === 404) {
          if (active) {
            setNotFound(true);
          }
          return null;
        }
        if (!response.ok) {
          throw new Error("Order status request failed");
        }
        return response.json() as Promise<{ data: unknown }>;
      })
      .then((response) => {
        if (!active || !response || !isCheckoutOrder(response.data)) {
          return;
        }
        setOrder(response.data);
        setStatusUnavailable(false);
      })
      .catch(() => {
        if (active) {
          setStatusUnavailable(true);
        }
      })
      .finally(() => {
        if (active) {
          setIsLoading(false);
        }
      });

    return () => {
      active = false;
    };
  }, [orderId, refreshKey]);

  if (isLoading) {
    return (
      <main className="checkout-page">
        <section className="checkout-card">
          <p role="status">Cargando tu pedido...</p>
        </section>
      </main>
    );
  }

  if (!order) {
    return (
      <main className="checkout-page">
        <section className="checkout-card">
          {statusUnavailable ? (
            <>
              <p className="eyebrow">Pedido</p>
              <h1>No pudimos consultar el pedido.</h1>
              <p>Intenta actualizar el estado cuando el servicio esté disponible.</p>
              <button
                type="button"
                onClick={() => {
                  setStatusUnavailable(false);
                  setIsLoading(true);
                  setRefreshKey((current) => current + 1);
                }}
              >
                Volver a intentar
              </button>
            </>
          ) : (
            <>
              <p className="eyebrow">Pedido</p>
              <h1>{notFound ? "No encontramos este pedido." : "No hay un pedido activo."}</h1>
              <p>Vuelve al catálogo para completar tu compra.</p>
            </>
          )}
        </section>
      </main>
    );
  }

  return (
    <main className="checkout-page">
      <section className="checkout-card">
        <p className="eyebrow">Estado del pedido</p>
        <h1>
          {order.status === "CANCELLED"
            ? "Pedido cancelado"
            : order.status === "CONFIRMED"
              ? "Pedido confirmado"
              : "Pedido recibido"}
        </h1>
        <p role="status">{statusLabel(order.status)}</p>
        {statusUnavailable && (
          <p className="notice-error" role="alert">
            No pudimos actualizar el estado ahora. Mostramos los últimos datos consultados.
          </p>
        )}

        <div className="order-meta">
          <span>ID de pedido</span>
          <strong>{order.orderId}</strong>
        </div>

        <p>
          Tu pedido quedó registrado. Revisa el resumen que se abre en WhatsApp y pulsa Enviar para compartirlo con
          la tienda. Si realizas un pago, adjunta el comprobante manualmente en ese chat; WhatsApp no lo adjunta ni
          lo envía por ti.
        </p>
        {whatsAppUrl ? (
          <a className="checkout-button" href={whatsAppUrl} target="_blank" rel="noopener noreferrer">
            Abrir WhatsApp con el resumen
          </a>
        ) : (
          <p className="notice-error" role="status">
            Tu pedido está guardado, pero falta configurar el número internacional de WhatsApp Business de la tienda.
          </p>
        )}

        <ul className="order-lines">
          {order.lines.map((line) => (
            <li key={line.productId}>
              <div>
                <strong>{line.name}</strong>
                <span>{line.quantity} x {formatPrice(line.unitPriceCop)}</span>
              </div>
              <strong>{formatPrice(line.unitPriceCop * line.quantity)}</strong>
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
      </section>
    </main>
  );
}
