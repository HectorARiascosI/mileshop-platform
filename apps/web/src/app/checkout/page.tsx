"use client";

import { useMemo, useState } from "react";

import { buildCheckoutSummary } from "@/lib/order";
import type { CartLine } from "@/lib/cart";

const STORAGE_KEY = "mileshop-last-order-v1";

function formatPrice(priceCop: number): string {
  return new Intl.NumberFormat("es-CO", {
    style: "currency",
    currency: "COP",
    maximumFractionDigits: 0,
  }).format(priceCop);
}

export default function CheckoutPage() {
  const [order] = useState<{
    aggregateId: string;
    payload: {
      customerId: string;
      totalCop: number;
      currency: "COP";
      lines: Array<{
        productId: string;
        sku: string;
        name: string;
        quantity: number;
        unitPriceCop: number;
      }>;
    };
  } | null>(() => {
    if (typeof window === "undefined") {
      return null;
    }

    const rawOrder = window.localStorage.getItem(STORAGE_KEY);
    if (!rawOrder) {
      return null;
    }

    try {
      const parsed = JSON.parse(rawOrder) as {
        aggregateId: string;
        payload: {
          customerId: string;
          totalCop: number;
          currency: "COP";
          lines: Array<{
            productId: string;
            sku: string;
            name: string;
            quantity: number;
            unitPriceCop: number;
          }>;
        };
      };
      return parsed;
    } catch {
      window.localStorage.removeItem(STORAGE_KEY);
      return null;
    }
  });

  const lines = useMemo<CartLine[]>(() => {
    if (!order) {
      return [];
    }

    return order.payload.lines.map((line) => ({
      productId: line.productId,
      sku: line.sku,
      name: line.name,
      priceCop: line.unitPriceCop,
      quantity: line.quantity,
    }));
  }, [order]);

  const summary = useMemo(() => buildCheckoutSummary(lines), [lines]);

  if (!order) {
    return (
      <main className="checkout-page">
        <section className="checkout-card">
          <p className="eyebrow">Pedido</p>
          <h1>No hay un pedido activo.</h1>
          <p>Vuelve al catálogo para completar tu compra.</p>
        </section>
      </main>
    );
  }

  return (
    <main className="checkout-page">
      <section className="checkout-card">
        <p className="eyebrow">Pedido confirmado</p>
        <h1>Gracias por tu compra</h1>

        <div className="order-meta">
          <span>ID de pedido</span>
          <strong>{order.aggregateId}</strong>
        </div>

        <ul className="order-lines">
          {lines.map((line) => (
            <li key={line.productId}>
              <div>
                <strong>{line.name}</strong>
                <span>{line.quantity} x {formatPrice(line.priceCop)}</span>
              </div>
              <strong>{formatPrice(line.priceCop * line.quantity)}</strong>
            </li>
          ))}
        </ul>

        <div className="checkout-summary checkout-summary-inline">
          <div>
            <span>Subtotal</span>
            <strong>{formatPrice(summary.subtotalCop)}</strong>
          </div>
          <div>
            <span>Envío</span>
            <strong>{summary.isFreeDelivery ? "Gratis" : formatPrice(summary.deliveryFeeCop)}</strong>
          </div>
          <div className="checkout-total">
            <span>Total</span>
            <strong>{formatPrice(order.payload.totalCop)}</strong>
          </div>
        </div>
      </section>
    </main>
  );
}
