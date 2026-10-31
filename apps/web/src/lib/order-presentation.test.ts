import assert from "node:assert/strict";
import test from "node:test";

import {
  getOrderStatusMessage,
  isPaymentDecisionForStatus,
} from "./order-presentation";

test("presents a rejected payment as cancelled and never paid", () => {
  const decision = {
    decision: "REJECTED" as const,
    decidedAt: "2026-10-30T12:00:00.000Z",
    reason: "El comprobante no coincide con el total.",
  };

  assert.deepEqual(getOrderStatusMessage("CANCELLED", decision), {
    title: "Pago rechazado",
    description:
      "El pago fue rechazado y el pedido quedó cancelado. No realices otro pago por este pedido.",
  });
  assert.equal(isPaymentDecisionForStatus(decision, "CANCELLED"), true);
});

test("requires a non-empty reason and cancelled order for rejected decisions", () => {
  const validDate = "2026-10-30T12:00:00.000Z";

  assert.equal(
    isPaymentDecisionForStatus(
      { decision: "REJECTED", decidedAt: validDate, reason: "  " },
      "CANCELLED",
    ),
    false,
  );
  assert.equal(
    isPaymentDecisionForStatus(
      { decision: "REJECTED", decidedAt: validDate, reason: "Motivo" },
      "PAYMENT_REVIEW_PENDING",
    ),
    false,
  );
  assert.equal(
    isPaymentDecisionForStatus(
      { decision: "REJECTED", decidedAt: validDate, reason: "Motivo" },
      "CANCELLED",
    ),
    true,
  );
});

test("keeps approved and ordinary cancelled orders on their existing status copy", () => {
  const approval = {
    decision: "APPROVED" as const,
    decidedAt: "2026-10-30T12:00:00.000Z",
    reason: null,
  };

  assert.deepEqual(getOrderStatusMessage("PAYMENT_APPROVED_FINALIZING", approval), {
    title: "Pago aprobado, confirmando pedido",
    description:
      "El pago fue aprobado. Estamos confirmando el inventario reservado y actualizaremos este estado al terminar.",
  });
  assert.deepEqual(getOrderStatusMessage("CANCELLED", null), {
    title: "Pedido cancelado",
    description:
      "Cancelamos el pedido y la liberación de la reserva se procesa automáticamente. No realices pagos por este pedido.",
  });
});

test("presents an expired reservation as terminal and never payable", () => {
  assert.deepEqual(getOrderStatusMessage("RESERVATION_EXPIRED", null), {
    title: "Reserva vencida",
    description:
      "No recibimos el comprobante antes del vencimiento. El pedido expiró y no se procesará ningún pago.",
  });
});
