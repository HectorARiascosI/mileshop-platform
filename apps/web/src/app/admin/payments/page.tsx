"use client";

import Link from "next/link";
import { useCallback, useEffect, useState } from "react";

type EvidenceMetadata = {
  originalFileName: string;
  contentType: "application/pdf" | "image/jpeg" | "image/png";
  sizeBytes: number;
  transactionReference: string | null;
  receivedAt: string;
  available: boolean;
  deletedAt: string | null;
};

type PaymentQueueEntry = {
  orderId: string;
  customerId: string;
  totalCop: number;
  createdAt: string;
  reservationExpiresAt: string | null;
  evidence: EvidenceMetadata;
};

type PaymentReviewDetail = {
  order: {
    orderId: string;
    customerId: string;
    subtotalCop: number;
    deliveryFeeCop: number;
    totalCop: number;
    createdAt: string;
    reservationExpiresAt: string | null;
    cancellationRequest: {
      requestedAt: string;
      resolvedAt: string | null;
      resolution: "CANCELLED" | "KEPT_OPEN" | null;
    } | null;
    lines: Array<{
      id: string;
      productId: string;
      sku: string;
      name: string;
      quantity: number;
      unitPriceCop: number;
    }>;
  };
  evidence: EvidenceMetadata;
};

type CancellationRequestEntry = {
  orderId: string;
  customerId: string;
  totalCop: number;
  createdAt: string;
  requestedAt: string;
  paymentCaptured: boolean | null;
  refundHandledAt: string | null;
  externalRefundReference: string | null;
  refundRecordedByCustomerId: string | null;
};

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function isDate(value: unknown): value is string {
  return typeof value === "string" && Number.isFinite(Date.parse(value));
}

function isCancellationRequest(
  value: unknown,
): value is PaymentReviewDetail["order"]["cancellationRequest"] {
  if (value === null) {
    return true;
  }
  if (
    !isRecord(value) ||
    !isDate(value.requestedAt) ||
    (value.resolvedAt !== null && !isDate(value.resolvedAt)) ||
    (value.resolution !== null &&
      value.resolution !== "CANCELLED" &&
      value.resolution !== "KEPT_OPEN")
  ) {
    return false;
  }
  return (value.resolvedAt === null) === (value.resolution === null);
}

function isEvidenceMetadata(value: unknown): value is EvidenceMetadata {
  return (
    isRecord(value) &&
    typeof value.originalFileName === "string" &&
    (value.contentType === "application/pdf" ||
      value.contentType === "image/jpeg" ||
      value.contentType === "image/png") &&
    typeof value.sizeBytes === "number" &&
    Number.isSafeInteger(value.sizeBytes) &&
    value.sizeBytes > 0 &&
    (value.transactionReference === null ||
      typeof value.transactionReference === "string") &&
    isDate(value.receivedAt) &&
    typeof value.available === "boolean" &&
    (value.deletedAt === null || isDate(value.deletedAt))
  );
}

function parseQueue(value: unknown): PaymentQueueEntry[] | null {
  if (!isRecord(value) || !Array.isArray(value.data)) {
    return null;
  }
  const entries = value.data;
  if (
    !entries.every(
      (entry) =>
        isRecord(entry) &&
        typeof entry.orderId === "string" &&
        typeof entry.customerId === "string" &&
        typeof entry.totalCop === "number" &&
        Number.isSafeInteger(entry.totalCop) &&
        isDate(entry.createdAt) &&
        (entry.reservationExpiresAt === null || isDate(entry.reservationExpiresAt)) &&
        isEvidenceMetadata(entry.evidence),
    )
  ) {
    return null;
  }
  return entries as PaymentQueueEntry[];
}

function parseReviewDetail(value: unknown): PaymentReviewDetail | null {
  if (!isRecord(value) || !isRecord(value.data)) {
    return null;
  }
  const { order, evidence } = value.data;
  if (
    !isRecord(order) ||
    order.status !== "PAYMENT_REVIEW_PENDING" ||
    typeof order.orderId !== "string" ||
    typeof order.customerId !== "string" ||
    typeof order.subtotalCop !== "number" ||
    !Number.isSafeInteger(order.subtotalCop) ||
    typeof order.deliveryFeeCop !== "number" ||
    !Number.isSafeInteger(order.deliveryFeeCop) ||
    typeof order.totalCop !== "number" ||
    !Number.isSafeInteger(order.totalCop) ||
    !isDate(order.createdAt) ||
    (order.reservationExpiresAt !== null && !isDate(order.reservationExpiresAt)) ||
    !isCancellationRequest(order.cancellationRequest) ||
    !Array.isArray(order.lines) ||
    !order.lines.every(
      (line) =>
        isRecord(line) &&
        typeof line.id === "string" &&
        typeof line.productId === "string" &&
        typeof line.sku === "string" &&
        typeof line.name === "string" &&
        typeof line.quantity === "number" &&
        Number.isSafeInteger(line.quantity) &&
        line.quantity > 0 &&
        typeof line.unitPriceCop === "number" &&
        Number.isSafeInteger(line.unitPriceCop) &&
        line.unitPriceCop >= 0,
    ) ||
    !isEvidenceMetadata(evidence)
  ) {
    return null;
  }

  return {
    order: {
      orderId: order.orderId,
      customerId: order.customerId,
      subtotalCop: order.subtotalCop,
      deliveryFeeCop: order.deliveryFeeCop,
      totalCop: order.totalCop,
      createdAt: order.createdAt,
      reservationExpiresAt: order.reservationExpiresAt,
      cancellationRequest: order.cancellationRequest,
      lines: order.lines,
    },
    evidence,
  };
}

function parseCancellationRequests(value: unknown): CancellationRequestEntry[] | null {
  if (!isRecord(value) || !Array.isArray(value.data)) {
    return null;
  }
  const entries = value.data;
  if (
    !entries.every(
      (entry) =>
        isRecord(entry) &&
        typeof entry.orderId === "string" &&
        typeof entry.customerId === "string" &&
        typeof entry.totalCop === "number" &&
        Number.isSafeInteger(entry.totalCop) &&
        isDate(entry.createdAt) &&
        isDate(entry.requestedAt) &&
        (entry.paymentCaptured === null || typeof entry.paymentCaptured === "boolean") &&
        (entry.refundHandledAt === null || isDate(entry.refundHandledAt)) &&
        (entry.externalRefundReference === null ||
          typeof entry.externalRefundReference === "string") &&
        (entry.refundRecordedByCustomerId === null ||
          typeof entry.refundRecordedByCustomerId === "string"),
    )
  ) {
    return null;
  }
  return entries as CancellationRequestEntry[];
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
    dateStyle: "medium",
    timeStyle: "short",
  }).format(new Date(value));
}

function errorMessage(status: number): string {
  if (status === 401) {
    return "Inicia sesión con una cuenta autorizada para revisar pagos.";
  }
  if (status === 403) {
    return "Tu cuenta no tiene permisos de administración de tienda.";
  }
  if (status === 404) {
    return "Este pago ya no está pendiente. Actualiza la cola para ver los cambios.";
  }
  return "No pudimos consultar los pagos pendientes. Inténtalo de nuevo.";
}

type QueueRequestResult =
  | { entries: PaymentQueueEntry[] }
  | { error: { status: number; message: string } };

async function requestPaymentQueue(): Promise<QueueRequestResult> {
  try {
    const response = await fetch("/api/admin/payments", { cache: "no-store" });
    if (!response.ok) {
      return {
        error: {
          status: response.status,
          message: errorMessage(response.status),
        },
      };
    }
    const entries = parseQueue(await response.json());
    if (!entries) {
      return {
        error: {
          status: 502,
          message: "El servicio devolvió una cola de pagos inválida.",
        },
      };
    }
    return { entries };
  } catch {
    return {
      error: {
        status: 503,
        message: "No pudimos conectar con el servicio de pagos.",
      },
    };
  }
}

async function requestCancellationQueue(): Promise<
  | { entries: CancellationRequestEntry[] }
  | { error: { status: number; message: string } }
> {
  try {
    const response = await fetch("/api/admin/cancellation-requests", { cache: "no-store" });
    if (!response.ok) {
      return {
        error: {
          status: response.status,
          message: errorMessage(response.status),
        },
      };
    }
    const entries = parseCancellationRequests(await response.json());
    if (!entries) {
      return {
        error: {
          status: 502,
          message: "El servicio devolvió solicitudes de cancelación inválidas.",
        },
      };
    }
    return { entries };
  } catch {
    return {
      error: {
        status: 503,
        message: "No pudimos conectar con el servicio de solicitudes.",
      },
    };
  }
}

export default function AdminPaymentsPage() {
  const [queue, setQueue] = useState<PaymentQueueEntry[]>([]);
  const [cancellationRequests, setCancellationRequests] = useState<
    CancellationRequestEntry[]
  >([]);
  const [selectedOrderId, setSelectedOrderId] = useState<string | null>(null);
  const [selectedCancellationOrderId, setSelectedCancellationOrderId] = useState<string | null>(null);
  const [detail, setDetail] = useState<PaymentReviewDetail | null>(null);
  const [detailRefreshVersion, setDetailRefreshVersion] = useState(0);
  const [isLoadingQueue, setIsLoadingQueue] = useState(true);
  const [isLoadingCancellationRequests, setIsLoadingCancellationRequests] = useState(true);
  const [isLoadingDetail, setIsLoadingDetail] = useState(false);
  const [isApproving, setIsApproving] = useState(false);
  const [isRejecting, setIsRejecting] = useState(false);
  const [isDeletingEvidence, setIsDeletingEvidence] = useState(false);
  const [isRecordingRefund, setIsRecordingRefund] = useState(false);
  const [isResolvingCancellation, setIsResolvingCancellation] = useState(false);
  const [rejectionReason, setRejectionReason] = useState("");
  const [cancellationResolutionNote, setCancellationResolutionNote] = useState("");
  const [paymentCapturedSelection, setPaymentCapturedSelection] = useState<
    "unknown" | "captured" | "not-captured"
  >("unknown");
  const [externalRefundReference, setExternalRefundReference] = useState("");
  const [decisionError, setDecisionError] = useState<string | null>(null);
  const [decisionNotice, setDecisionNotice] = useState<string | null>(null);
  const [cancellationError, setCancellationError] = useState<string | null>(null);
  const [cancellationNotice, setCancellationNotice] = useState<string | null>(null);
  const [error, setError] = useState<{ status: number; message: string } | null>(null);

  const applyQueueResult = useCallback((result: QueueRequestResult) => {
    setIsLoadingQueue(false);
    if ("error" in result) {
      setError(result.error);
      setQueue([]);
      setDetail(null);
      return;
    }
    setError(null);
    setQueue(result.entries);
    setSelectedOrderId((current) =>
      result.entries.some((entry) => entry.orderId === current)
        ? current
        : result.entries[0]?.orderId ?? null,
    );
    setDetailRefreshVersion((current) => current + 1);
    if (result.entries.length === 0) {
      setDetail(null);
    }
  }, []);

  useEffect(() => {
    let active = true;
    void requestPaymentQueue().then((result) => {
      if (active) {
        applyQueueResult(result);
      }
    });
    return () => {
      active = false;
    };
  }, [applyQueueResult]);

  const applyCancellationQueueResult = useCallback(
    (result: Awaited<ReturnType<typeof requestCancellationQueue>>) => {
      setIsLoadingCancellationRequests(false);
      if ("error" in result) {
        setCancellationError(result.error.message);
        setCancellationRequests([]);
        setSelectedCancellationOrderId(null);
        return;
      }
      setCancellationError(null);
      setCancellationRequests(result.entries);
      setSelectedCancellationOrderId((current) =>
        result.entries.some((entry) => entry.orderId === current)
          ? current
          : result.entries[0]?.orderId ?? null,
      );
    },
    [],
  );

  useEffect(() => {
    let active = true;
    void requestCancellationQueue().then((result) => {
      if (active) {
        applyCancellationQueueResult(result);
      }
    });
    return () => {
      active = false;
    };
  }, [applyCancellationQueueResult]);

  const refreshCancellationRequests = useCallback(async () => {
    setIsLoadingCancellationRequests(true);
    applyCancellationQueueResult(await requestCancellationQueue());
  }, [applyCancellationQueueResult]);

  const refreshQueue = useCallback(async () => {
    setIsLoadingQueue(true);
    setIsLoadingDetail(Boolean(selectedOrderId));
    setError(null);
    setDetail(null);
    applyQueueResult(await requestPaymentQueue());
  }, [applyQueueResult, selectedOrderId]);

  const deleteDownloadedEvidence = useCallback(async () => {
    if (!detail || !detail.evidence.available || isDeletingEvidence) {
      return;
    }
    if (
      !window.confirm(
        "Confirma que descargaste y guardaste este comprobante en un lugar seguro. La copia del servidor se eliminará y no podrá descargarse otra vez.",
      )
    ) {
      return;
    }

    const orderId = detail.order.orderId;
    setIsDeletingEvidence(true);
    setDecisionError(null);
    setDecisionNotice(null);
    try {
      const response = await fetch(
        `/api/admin/payments/${encodeURIComponent(orderId)}/evidence`,
        {
          method: "POST",
          cache: "no-store",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({ confirmDownloaded: true }),
        },
      );
      if (response.status === 401 || response.status === 403) {
        throw new Error(errorMessage(response.status));
      }
      if (response.status === 404) {
        throw new Error("No encontramos el comprobante. Actualiza la cola antes de continuar.");
      }
      if (response.status === 409) {
        throw new Error(
          "El comprobante tiene una retención activa o una eliminación en curso; actualiza e inténtalo de nuevo.",
        );
      }
      if (!response.ok) {
        throw new Error("No pudimos eliminar la copia del servidor. Inténtalo de nuevo.");
      }

      const payload: unknown = await response.json();
      if (
        !isRecord(payload) ||
        !isRecord(payload.data) ||
        payload.data.orderId !== orderId ||
        payload.data.available !== false ||
        !isDate(payload.data.deletedAt)
      ) {
        throw new Error("El servicio devolvió una confirmación de eliminación inválida.");
      }

      const deletedAt = payload.data.deletedAt;
      setDetail((current) =>
        current?.order.orderId === orderId
          ? {
              ...current,
              evidence: { ...current.evidence, available: false, deletedAt },
            }
          : current,
      );
      setQueue((current) =>
        current.map((entry) =>
          entry.orderId === orderId
            ? {
                ...entry,
                evidence: { ...entry.evidence, available: false, deletedAt },
              }
            : entry,
        ),
      );
      setDecisionNotice(
        "La copia del servidor se eliminó. El pedido sigue pendiente y puedes terminar su revisión.",
      );
    } catch (requestError) {
      setDecisionError(
        requestError instanceof Error
          ? requestError.message
          : "No pudimos eliminar la copia del servidor. Inténtalo de nuevo.",
      );
    } finally {
      setIsDeletingEvidence(false);
    }
  }, [detail, isDeletingEvidence]);

  const selectedCancellationRequest = cancellationRequests.find(
    (entry) => entry.orderId === selectedCancellationOrderId,
  ) ?? null;

  const recordCancellationRefund = useCallback(async () => {
    if (!selectedCancellationRequest || isRecordingRefund) {
      return;
    }
    if (paymentCapturedSelection === "unknown") {
      setCancellationError("Indica si el pago fue capturado.");
      return;
    }
    const paymentCaptured = paymentCapturedSelection === "captured";
    const refundReference = externalRefundReference.trim();
    if (paymentCaptured && !refundReference) {
      setCancellationError("Registra la referencia del reembolso externo antes de continuar.");
      return;
    }
    setIsRecordingRefund(true);
    setCancellationError(null);
    setCancellationNotice(null);
    try {
      const response = await fetch(
        `/api/admin/cancellation-requests/${encodeURIComponent(selectedCancellationRequest.orderId)}/refund-handling`,
        {
          method: "POST",
          cache: "no-store",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({
            paymentCaptured,
            externalRefundReference: paymentCaptured ? refundReference : null,
          }),
        },
      );
      if (response.status === 409) {
        throw new Error("La solicitud ya cambió. Actualiza la lista antes de continuar.");
      }
      if (response.status === 401 || response.status === 403) {
        throw new Error(errorMessage(response.status));
      }
      if (!response.ok) {
        throw new Error("No pudimos registrar el manejo del reembolso.");
      }
      const payload: unknown = await response.json();
      if (
        !isRecord(payload) ||
        !isRecord(payload.data) ||
        payload.data.orderId !== selectedCancellationRequest.orderId ||
        payload.data.status !== "PAYMENT_REVIEW_PENDING" ||
        !isCancellationRequest(payload.data.cancellationRequest) ||
        !payload.data.cancellationRequest ||
        payload.data.cancellationRequest.resolvedAt !== null
      ) {
        throw new Error("El servicio devolvió un registro de reembolso inválido.");
      }
      setCancellationNotice(
        paymentCaptured
          ? "El registro del reembolso externo quedó guardado; MileShop no ejecuta el reembolso."
          : "Quedó registrada la confirmación de que no hubo pago capturado.",
      );
      await refreshCancellationRequests();
    } catch (requestError) {
      setCancellationError(
        requestError instanceof Error
          ? requestError.message
          : "No pudimos registrar el manejo del reembolso.",
      );
    } finally {
      setIsRecordingRefund(false);
    }
  }, [
    externalRefundReference,
    isRecordingRefund,
    paymentCapturedSelection,
    refreshCancellationRequests,
    selectedCancellationRequest,
  ]);

  const resolveCancellationRequest = useCallback(async (action: "CANCEL" | "KEEP_OPEN") => {
    if (!selectedCancellationRequest || isResolvingCancellation) {
      return;
    }
    if (
      action === "CANCEL" &&
      !window.confirm(
        "¿Confirmas cancelar el pedido? La reserva se liberará y MileShop no procesa reembolsos.",
      )
    ) {
      return;
    }
    const note = cancellationResolutionNote.trim();
    if (!note) {
      setCancellationError("Escribe una nota de resolución para la auditoría.");
      return;
    }
    if (
      action === "CANCEL" &&
      (selectedCancellationRequest.paymentCaptured === null ||
        (selectedCancellationRequest.paymentCaptured &&
          (!selectedCancellationRequest.refundHandledAt ||
            !selectedCancellationRequest.externalRefundReference)))
    ) {
      setCancellationError("Registra primero el estado del pago y el reembolso externo requerido.");
      return;
    }
    setIsResolvingCancellation(true);
    setCancellationError(null);
    setCancellationNotice(null);
    try {
      const response = await fetch(
        `/api/admin/cancellation-requests/${encodeURIComponent(selectedCancellationRequest.orderId)}/resolve`,
        {
          method: "POST",
          cache: "no-store",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({ action, note }),
        },
      );
      if (response.status === 409) {
        throw new Error("No se pudo resolver: verifica el registro del reembolso y actualiza la lista.");
      }
      if (response.status === 401 || response.status === 403) {
        throw new Error(errorMessage(response.status));
      }
      if (!response.ok) {
        throw new Error("No pudimos resolver la solicitud de cancelación.");
      }
      const payload: unknown = await response.json();
      const expectedStatus = action === "CANCEL" ? "CANCELLED" : "PAYMENT_REVIEW_PENDING";
      const expectedResolution = action === "CANCEL" ? "CANCELLED" : "KEPT_OPEN";
      if (
        !isRecord(payload) ||
        !isRecord(payload.data) ||
        payload.data.orderId !== selectedCancellationRequest.orderId ||
        payload.data.status !== expectedStatus ||
        !isCancellationRequest(payload.data.cancellationRequest) ||
        !payload.data.cancellationRequest ||
        payload.data.cancellationRequest.resolution !== expectedResolution
      ) {
        throw new Error("El servicio devolvió una resolución inválida.");
      }
      setCancellationNotice(
        action === "CANCEL"
          ? "Pedido cancelado; la liberación de inventario se procesa de forma durable."
          : "Solicitud resuelta: el pedido sigue abierto y vuelve a la revisión de pago.",
      );
      setCancellationResolutionNote("");
      await Promise.all([refreshCancellationRequests(), refreshQueue()]);
    } catch (requestError) {
      setCancellationError(
        requestError instanceof Error
          ? requestError.message
          : "No pudimos resolver la solicitud de cancelación.",
      );
    } finally {
      setIsResolvingCancellation(false);
    }
  }, [
    cancellationResolutionNote,
    isResolvingCancellation,
    refreshCancellationRequests,
    refreshQueue,
    selectedCancellationRequest,
  ]);

  const approvePayment = useCallback(async () => {
    if (!detail || isApproving || detail.order.cancellationRequest?.resolvedAt === null) {
      return;
    }
    setIsApproving(true);
    setDecisionError(null);
    setDecisionNotice(null);
    try {
      const response = await fetch(
        `/api/admin/payments/${encodeURIComponent(detail.order.orderId)}/approve`,
        { method: "POST", cache: "no-store" },
      );
      if (response.status === 409) {
        throw new Error("Este pago ya no está pendiente. Actualiza la cola antes de continuar.");
      }
      if (response.status === 401 || response.status === 403) {
        throw new Error(errorMessage(response.status));
      }
      if (!response.ok) {
        throw new Error("No pudimos aprobar el pago. Inténtalo de nuevo.");
      }
      const payload: unknown = await response.json();
      if (
        !isRecord(payload) ||
        !isRecord(payload.data) ||
        payload.data.orderId !== detail.order.orderId ||
        (payload.data.status !== "PAYMENT_APPROVED_FINALIZING" &&
          payload.data.status !== "CONFIRMED") ||
        !isRecord(payload.data.paymentDecision) ||
        payload.data.paymentDecision.decision !== "APPROVED"
      ) {
        throw new Error("El servicio devolvió una respuesta de aprobación inválida.");
      }
      setDecisionNotice(
        payload.data.status === "CONFIRMED"
          ? `${detail.order.orderId}: pago aprobado y pedido confirmado.`
          : `${detail.order.orderId}: pago aprobado; estamos confirmando el inventario reservado.`,
      );
      setDetail(null);
      setIsLoadingQueue(true);
      applyQueueResult(await requestPaymentQueue());
    } catch (requestError) {
      setDecisionError(
        requestError instanceof Error
          ? requestError.message
          : "No pudimos aprobar el pago. Inténtalo de nuevo.",
      );
    } finally {
      setIsApproving(false);
    }
  }, [applyQueueResult, detail, isApproving]);

  const rejectPayment = useCallback(async () => {
    if (
      !detail ||
      isApproving ||
      isRejecting ||
      detail.order.cancellationRequest?.resolvedAt === null
    ) {
      return;
    }
    const reason = rejectionReason.trim();
    if (!reason) {
      setDecisionError("Escribe una razón para rechazar el pago.");
      return;
    }
    setIsRejecting(true);
    setDecisionError(null);
    setDecisionNotice(null);
    try {
      const response = await fetch(
        `/api/admin/payments/${encodeURIComponent(detail.order.orderId)}/reject`,
        {
          method: "POST",
          cache: "no-store",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({ reason }),
        },
      );
      if (response.status === 409) {
        throw new Error("Este pago ya no está pendiente. Actualiza la cola antes de continuar.");
      }
      if (response.status === 401 || response.status === 403) {
        throw new Error(errorMessage(response.status));
      }
      if (!response.ok) {
        throw new Error("No pudimos rechazar el pago. Inténtalo de nuevo.");
      }
      const payload: unknown = await response.json();
      if (
        !isRecord(payload) ||
        !isRecord(payload.data) ||
        payload.data.orderId !== detail.order.orderId ||
        payload.data.status !== "CANCELLED" ||
        !isRecord(payload.data.paymentDecision) ||
        payload.data.paymentDecision.decision !== "REJECTED" ||
        payload.data.paymentDecision.reason !== reason
      ) {
        throw new Error("El servicio devolvió una respuesta de rechazo inválida.");
      }
      setDecisionNotice(
        `${detail.order.orderId}: pago rechazado. La liberación del inventario se procesa automáticamente.`,
      );
      setRejectionReason("");
      setDetail(null);
      setIsLoadingQueue(true);
      applyQueueResult(await requestPaymentQueue());
    } catch (requestError) {
      setDecisionError(
        requestError instanceof Error
          ? requestError.message
          : "No pudimos rechazar el pago. Inténtalo de nuevo.",
      );
    } finally {
      setIsRejecting(false);
    }
  }, [applyQueueResult, detail, isApproving, isRejecting, rejectionReason]);

  useEffect(() => {
    if (!selectedOrderId) {
      return;
    }
    let active = true;
    void fetch(`/api/admin/payments/${encodeURIComponent(selectedOrderId)}`, {
      cache: "no-store",
    })
      .then(async (response) => {
        if (!response.ok) {
          if (active) {
            setError({
              status: response.status,
              message: errorMessage(response.status),
            });
            setDetail(null);
          }
          return;
        }
        const parsed = parseReviewDetail(await response.json());
        if (!parsed || parsed.order.orderId !== selectedOrderId) {
          throw new Error("Invalid payment review response");
        }
        if (active) {
          setError(null);
          setDetail(parsed);
        }
      })
      .catch(() => {
        if (active) {
          setError({
            status: 502,
            message: "No pudimos cargar el detalle de este pago.",
          });
          setDetail(null);
        }
      })
      .finally(() => {
        if (active) {
          setIsLoadingDetail(false);
        }
      });

    return () => {
      active = false;
    };
  }, [selectedOrderId, detailRefreshVersion]);

  const requiresLogin = error?.status === 401;
  const isForbidden = error?.status === 403;
  const paymentReviewBlockedByCancellation =
    detail?.order.cancellationRequest?.resolvedAt === null;

  return (
    <main className="admin-payments-page">
      <header className="admin-payments-header">
        <div>
          <p className="eyebrow">MileShop · Administración</p>
          <h1>Revisión de pagos</h1>
          <p className="admin-payments-intro">
            Revisa los comprobantes recibidos y consulta el detalle de cada pedido.
          </p>
        </div>
        <div className="admin-payments-actions">
          <span className="admin-pending-count">
            {queue.length} {queue.length === 1 ? "pendiente" : "pendientes"}
          </span>
          <button
            className="checkout-button admin-refresh-button"
            type="button"
            onClick={() => void refreshQueue()}
            disabled={isLoadingQueue}
          >
            {isLoadingQueue ? "Actualizando…" : "Actualizar"}
          </button>
        </div>
      </header>

      {error && (
        <section className={`admin-alert ${isForbidden ? "notice-error" : ""}`} role="alert">
          <p>{error.message}</p>
          {requiresLogin && (
            <Link href="/login">Iniciar sesión</Link>
          )}
          {isForbidden && (
            <Link href="/">Volver al catálogo</Link>
          )}
        </section>
      )}
      {decisionError && <p className="admin-alert" role="alert">{decisionError}</p>}
      {decisionNotice && <p className="admin-alert" role="status">{decisionNotice}</p>}
      {cancellationError && <p className="admin-alert" role="alert">{cancellationError}</p>}
      {cancellationNotice && <p className="admin-alert" role="status">{cancellationNotice}</p>}

      <section className="admin-cancellation-panel">
        <header className="admin-detail-heading">
          <div>
            <p className="eyebrow">MileShop · Administración</p>
            <h2>Solicitudes de cancelación</h2>
            <p className="admin-muted">
              Estas solicitudes no liberan la reserva hasta que se resuelvan.
            </p>
          </div>
          <span className="admin-pending-count">
            {cancellationRequests.length}{" "}
            {cancellationRequests.length === 1 ? "solicitud" : "solicitudes"}
          </span>
        </header>
        {cancellationError && cancellationRequests.length === 0 ? (
          <p className="admin-muted" role="status">No pudimos cargar las solicitudes.</p>
        ) : isLoadingCancellationRequests && cancellationRequests.length === 0 ? (
          <p className="admin-muted" aria-live="polite">Cargando solicitudes…</p>
        ) : cancellationRequests.length === 0 ? (
          <p className="admin-muted">No hay solicitudes pendientes de resolución.</p>
        ) : (
          <div className="admin-review-layout">
            <section className="admin-queue" aria-label="Solicitudes de cancelación pendientes">
              <ul>
                {cancellationRequests.map((entry) => (
                  <li key={entry.orderId}>
                    <button
                      type="button"
                      className={`admin-queue-item ${selectedCancellationOrderId === entry.orderId ? "is-selected" : ""}`}
                      onClick={() => {
                        setSelectedCancellationOrderId(entry.orderId);
                        setCancellationResolutionNote("");
                        setPaymentCapturedSelection(
                          entry.paymentCaptured === null
                            ? "unknown"
                            : entry.paymentCaptured
                              ? "captured"
                              : "not-captured",
                        );
                        setExternalRefundReference(entry.externalRefundReference ?? "");
                        setCancellationError(null);
                      }}
                      aria-pressed={selectedCancellationOrderId === entry.orderId}
                    >
                      <span className="admin-queue-item-heading">
                        <strong>{entry.orderId}</strong>
                        <span>{formatPrice(entry.totalCop)}</span>
                      </span>
                      <span>Solicitada {formatDate(entry.requestedAt)}</span>
                      <span>Cliente {entry.customerId}</span>
                    </button>
                  </li>
                ))}
              </ul>
            </section>

            <section className="admin-review-detail" aria-live="polite">
              {!selectedCancellationRequest ? (
                <p className="admin-muted">Selecciona una solicitud para resolverla.</p>
              ) : (
                <>
                  <div className="admin-detail-heading">
                    <div>
                      <p className="eyebrow">Solicitud posterior al comprobante</p>
                      <h3>{selectedCancellationRequest.orderId}</h3>
                    </div>
                    <a
                      className="admin-download-link"
                      href={`/api/admin/payments/${encodeURIComponent(selectedCancellationRequest.orderId)}/evidence`}
                    >
                      Descargar comprobante
                    </a>
                  </div>
                  <dl className="admin-metadata-grid">
                    <div>
                      <dt>Pedido recibido</dt>
                      <dd>{formatDate(selectedCancellationRequest.createdAt)}</dd>
                    </div>
                    <div>
                      <dt>Cliente</dt>
                      <dd>{selectedCancellationRequest.customerId}</dd>
                    </div>
                    <div>
                      <dt>Solicitud</dt>
                      <dd>{formatDate(selectedCancellationRequest.requestedAt)}</dd>
                    </div>
                    <div>
                      <dt>Pago capturado</dt>
                      <dd>
                        {selectedCancellationRequest.paymentCaptured === null
                          ? "Aún no registrado"
                          : selectedCancellationRequest.paymentCaptured
                            ? "Sí"
                            : "No"}
                      </dd>
                    </div>
                    {selectedCancellationRequest.refundHandledAt && (
                      <div>
                        <dt>Reembolso externo registrado</dt>
                        <dd>
                          {formatDate(selectedCancellationRequest.refundHandledAt)}
                          {selectedCancellationRequest.refundRecordedByCustomerId
                            ? ` · ${selectedCancellationRequest.refundRecordedByCustomerId}`
                            : ""}
                        </dd>
                      </div>
                    )}
                    {selectedCancellationRequest.externalRefundReference && (
                      <div>
                        <dt>Referencia externa</dt>
                        <dd>{selectedCancellationRequest.externalRefundReference}</dd>
                      </div>
                    )}
                  </dl>

                  {selectedCancellationRequest.paymentCaptured === null && (
                    <fieldset className="admin-rejection-field">
                      <legend>¿Se capturó el pago?</legend>
                      <label>
                        <input
                          type="radio"
                          name="payment-captured"
                          checked={paymentCapturedSelection === "captured"}
                          onChange={() => setPaymentCapturedSelection("captured")}
                          disabled={isRecordingRefund || isResolvingCancellation}
                        />
                        Sí, el pago fue capturado
                      </label>
                      <label>
                        <input
                          type="radio"
                          name="payment-captured"
                          checked={paymentCapturedSelection === "not-captured"}
                          onChange={() => setPaymentCapturedSelection("not-captured")}
                          disabled={isRecordingRefund || isResolvingCancellation}
                        />
                        No hubo pago capturado
                      </label>
                      {paymentCapturedSelection === "captured" && (
                        <label>
                          Referencia del reembolso externo ya gestionado
                          <input
                            value={externalRefundReference}
                            onChange={(event) => setExternalRefundReference(event.target.value)}
                            maxLength={200}
                            required
                            disabled={isRecordingRefund || isResolvingCancellation}
                          />
                        </label>
                      )}
                      <button
                        className="checkout-button"
                        type="button"
                        onClick={() => void recordCancellationRefund()}
                        disabled={
                          isRecordingRefund ||
                          isResolvingCancellation ||
                          paymentCapturedSelection === "unknown" ||
                          (paymentCapturedSelection === "captured" &&
                            externalRefundReference.trim().length === 0)
                        }
                      >
                        {isRecordingRefund ? "Registrando…" : "Registrar estado del pago"}
                      </button>
                    </fieldset>
                  )}
                  {selectedCancellationRequest.paymentCaptured === true &&
                    !selectedCancellationRequest.refundHandledAt && (
                      <p className="admin-muted" role="alert">
                        No canceles hasta registrar que el reembolso se gestionó fuera de MileShop.
                      </p>
                    )}
                  <label className="admin-rejection-field">
                    Nota de resolución para auditoría
                    <textarea
                      value={cancellationResolutionNote}
                      onChange={(event) => setCancellationResolutionNote(event.target.value)}
                      maxLength={1000}
                      rows={3}
                      required
                      disabled={isRecordingRefund || isResolvingCancellation}
                    />
                  </label>
                  <div className="admin-payments-actions">
                    <button
                      className="checkout-button"
                      type="button"
                      onClick={() => void resolveCancellationRequest("KEEP_OPEN")}
                      disabled={
                        isRecordingRefund ||
                        isResolvingCancellation ||
                        cancellationResolutionNote.trim().length === 0
                      }
                    >
                      {isResolvingCancellation ? "Resolviendo…" : "Mantener pedido abierto"}
                    </button>
                    <button
                      className="checkout-button"
                      type="button"
                      onClick={() => void resolveCancellationRequest("CANCEL")}
                      disabled={
                        isRecordingRefund ||
                        isResolvingCancellation ||
                        cancellationResolutionNote.trim().length === 0 ||
                        selectedCancellationRequest.paymentCaptured === null ||
                        (selectedCancellationRequest.paymentCaptured === true &&
                          (!selectedCancellationRequest.refundHandledAt ||
                            !selectedCancellationRequest.externalRefundReference))
                      }
                    >
                      {isResolvingCancellation ? "Resolviendo…" : "Cancelar pedido"}
                    </button>
                  </div>
                  <p className="admin-muted">
                    MileShop no envía ni confirma reembolsos. La cancelación libera la reserva solo después de esta resolución.
                  </p>
                </>
              )}
            </section>
          </div>
        )}
      </section>

      {!error && !isLoadingQueue && queue.length === 0 && (
        <section className="admin-empty-state">
          <span aria-hidden="true">✓</span>
          <h2>No hay pagos pendientes</h2>
          <p>Los nuevos comprobantes aparecerán aquí para su revisión.</p>
        </section>
      )}

      {(isLoadingQueue || queue.length > 0) && (
        <div className="admin-review-layout">
          <section className="admin-queue" aria-label="Cola de pagos pendientes">
            <h2>Cola de revisión</h2>
            {isLoadingQueue && queue.length === 0 ? (
              <p className="admin-muted" aria-live="polite">Cargando pagos…</p>
            ) : (
              <ul>
                {queue.map((entry) => (
                  <li key={entry.orderId}>
                    <button
                      type="button"
                      className={`admin-queue-item ${selectedOrderId === entry.orderId ? "is-selected" : ""}`}
                      onClick={() => {
                        setDetail(null);
                        setRejectionReason("");
                        setIsLoadingDetail(true);
                        setError(null);
                        setSelectedOrderId(entry.orderId);
                        setDetailRefreshVersion((current) => current + 1);
                      }}
                      aria-pressed={selectedOrderId === entry.orderId}
                    >
                      <span className="admin-queue-item-heading">
                        <strong>{entry.orderId}</strong>
                        <span>{formatPrice(entry.totalCop)}</span>
                      </span>
                      <span>Recibido {formatDate(entry.evidence.receivedAt)}</span>
                      <span>Cliente {entry.customerId}</span>
                    </button>
                  </li>
                ))}
              </ul>
            )}
          </section>

          <section className="admin-review-detail" aria-live="polite">
            {(isLoadingDetail || (selectedOrderId && detail?.order.orderId !== selectedOrderId)) && (
              <p className="admin-muted">Cargando detalle del pedido…</p>
            )}
            {!isLoadingDetail && !detail && !error && (
              <p className="admin-muted">Selecciona un pago para revisar su información.</p>
            )}
            {detail && (
              <>
                {paymentReviewBlockedByCancellation && (
                  <p className="admin-alert" role="status">
                    Este pago está bloqueado hasta resolver la solicitud de cancelación.
                  </p>
                )}
                <div className="admin-detail-heading">
                  <div>
                    <p className="eyebrow">Pedido pendiente</p>
                    <h2>{detail.order.orderId}</h2>
                  </div>
                  {detail.evidence.available ? (
                    <div className="admin-evidence-actions">
                      <a
                        className="admin-download-link"
                        href={`/api/admin/payments/${encodeURIComponent(detail.order.orderId)}/evidence`}
                      >
                        Descargar comprobante
                      </a>
                      <button
                        className="checkout-button"
                        type="button"
                        onClick={() => void deleteDownloadedEvidence()}
                        disabled={isDeletingEvidence || isApproving || isRejecting}
                      >
                        {isDeletingEvidence
                          ? "Eliminando copia…"
                          : "Ya lo guardé, eliminar del servidor"}
                      </button>
                    </div>
                  ) : (
                    <p className="admin-muted" role="status">
                      Copia del servidor eliminada el{" "}
                      {detail.evidence.deletedAt
                        ? formatDate(detail.evidence.deletedAt)
                        : "fecha no disponible"}
                    </p>
                  )}
                </div>

                <dl className="admin-metadata-grid">
                  <div>
                    <dt>Cliente</dt>
                    <dd>{detail.order.customerId}</dd>
                  </div>
                  <div>
                    <dt>Comprobante recibido</dt>
                    <dd>{formatDate(detail.evidence.receivedAt)}</dd>
                  </div>
                  <div>
                    <dt>Nombre del archivo</dt>
                    <dd>{detail.evidence.originalFileName}</dd>
                  </div>
                  <div>
                    <dt>Tipo y tamaño</dt>
                    <dd>
                      {detail.evidence.contentType} · {(detail.evidence.sizeBytes / 1024).toFixed(0)} KB
                    </dd>
                  </div>
                  <div>
                    <dt>Referencia de transacción</dt>
                    <dd>{detail.evidence.transactionReference || "No proporcionada"}</dd>
                  </div>
                  <div>
                    <dt>Vencimiento de reserva</dt>
                    <dd>
                      {detail.order.reservationExpiresAt
                        ? formatDate(detail.order.reservationExpiresAt)
                        : "No disponible"}
                    </dd>
                  </div>
                </dl>

                <h3>Productos del pedido</h3>
                <ul className="admin-order-lines">
                  {detail.order.lines.map((line) => (
                    <li key={line.id}>
                      <div>
                        <strong>{line.name}</strong>
                        <span>{line.sku} · {line.quantity} × {formatPrice(line.unitPriceCop)}</span>
                      </div>
                      <strong>{formatPrice(line.quantity * line.unitPriceCop)}</strong>
                    </li>
                  ))}
                </ul>

                <dl className="admin-totals">
                  <div><dt>Subtotal</dt><dd>{formatPrice(detail.order.subtotalCop)}</dd></div>
                  <div><dt>Envío</dt><dd>{detail.order.deliveryFeeCop === 0 ? "Gratis" : formatPrice(detail.order.deliveryFeeCop)}</dd></div>
                  <div className="admin-grand-total"><dt>Total</dt><dd>{formatPrice(detail.order.totalCop)}</dd></div>
                </dl>
                <button
                  className="checkout-button"
                  type="button"
                  onClick={() => void approvePayment()}
                  disabled={
                    isApproving ||
                    isRejecting ||
                    isLoadingQueue ||
                    paymentReviewBlockedByCancellation
                  }
                >
                  {isApproving ? "Aprobando…" : "Aprobar pago"}
                </button>
                <label className="admin-rejection-field">
                  Razón del rechazo
                  <textarea
                    value={rejectionReason}
                    onChange={(event) => setRejectionReason(event.target.value)}
                    maxLength={1000}
                    rows={3}
                    required
                    aria-describedby="admin-rejection-help"
                    disabled={isApproving || isRejecting || isLoadingQueue}
                  />
                </label>
                <p id="admin-rejection-help" className="admin-muted">
                  Obligatoria; el cliente podrá consultarla en el detalle del pedido.
                </p>
                <button
                  className="checkout-button"
                  type="button"
                  onClick={() => void rejectPayment()}
                  disabled={
                    isApproving ||
                    isRejecting ||
                    isLoadingQueue ||
                    paymentReviewBlockedByCancellation ||
                    rejectionReason.trim().length === 0
                  }
                >
                  {isRejecting ? "Rechazando…" : "Rechazar pago"}
                </button>
              </>
            )}
          </section>
        </div>
      )}

      <footer className="admin-payments-footer">
        <Link href="/">Volver al catálogo</Link>
      </footer>
    </main>
  );
}
