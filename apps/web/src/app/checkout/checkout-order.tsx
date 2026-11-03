"use client";

import { useEffect, useState } from "react";

import {
  getOrderStatusMessage,
  isOrderStatus,
  isPaymentDecisionForStatus,
  type OrderStatus,
  type PaymentDecision,
} from "@/lib/order-presentation";
import { buildWhatsAppOrderUrl } from "@/lib/whatsapp-order";

type CheckoutOrderData = {
  orderId: string;
  subtotalCop: number;
  deliveryFeeCop: number;
  totalCop: number;
  status: OrderStatus;
  createdAt: string;
  paymentDecision: PaymentDecision | null;
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

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function isCheckoutLine(value: unknown): value is CheckoutOrderData["lines"][number] {
  return (
    isRecord(value) &&
    typeof value.productId === "string" &&
    typeof value.sku === "string" &&
    typeof value.name === "string" &&
    Number.isSafeInteger(value.quantity) &&
    Number(value.quantity) > 0 &&
    Number.isSafeInteger(value.unitPriceCop) &&
    Number(value.unitPriceCop) >= 0
  );
}

function isCheckoutOrder(value: unknown): value is CheckoutOrderData {
  if (!isRecord(value)) return false;
  return (
    typeof value.orderId === "string" &&
    Number.isSafeInteger(value.subtotalCop) &&
    Number(value.subtotalCop) >= 0 &&
    Number.isSafeInteger(value.deliveryFeeCop) &&
    Number(value.deliveryFeeCop) >= 0 &&
    Number.isSafeInteger(value.totalCop) &&
    Number(value.totalCop) >= 0 &&
    isOrderStatus(value.status) &&
    typeof value.createdAt === "string" &&
    Number.isFinite(Date.parse(value.createdAt)) &&
    isPaymentDecisionForStatus(value.paymentDecision, value.status) &&
    Array.isArray(value.lines) &&
    value.lines.every(isCheckoutLine)
  );
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
        if (!active || !response) {
          return;
        }
        if (!isCheckoutOrder(response.data)) {
          setStatusUnavailable(true);
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

  const statusMessage = getOrderStatusMessage(order.status, order.paymentDecision);

  return (
    <main className="checkout-page">
      <section className="checkout-card">
        <p className="eyebrow">Estado del pedido</p>
        <h1>{statusMessage.title}</h1>
        <p role="status">{statusMessage.description}</p>
        {statusUnavailable && (
          <p className="notice-error" role="alert">
            No pudimos actualizar el estado ahora. Mostramos los últimos datos consultados.
          </p>
        )}

        <div className="order-meta">
          <span>ID de pedido</span>
          <strong>{order.orderId}</strong>
        </div>

        {whatsAppUrl ? (
          <>
            <p>
              Revisa el resumen que se abre en WhatsApp. Si realizas un pago, adjunta el comprobante en el chat y pulsa
              Enviar para compartir la información con la tienda.
            </p>
            <a className="checkout-button" href={whatsAppUrl} target="_blank" rel="noopener noreferrer">
              Abrir WhatsApp con el resumen
            </a>
          </>
        ) : (
          <p className="notice-error" role="status">
            El pedido está guardado, pero no se pudo abrir el WhatsApp Business de MileShop. No realices pagos hasta que la tienda confirme cómo continuar.
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
