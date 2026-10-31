import {
  BadRequestException,
  Body,
  Controller,
  ConflictException,
  Delete,
  ForbiddenException,
  Get,
  Header,
  Headers,
  Inject,
  NotFoundException,
  PayloadTooLargeException,
  Param,
  Post,
  ServiceUnavailableException,
  StreamableFile,
  Req,
  UseGuards,
} from "@nestjs/common";
import type { FastifyRequest } from "fastify";

import { CatalogUnavailableError } from "./catalog.reader.js";
import {
  InvalidCancellationResolutionError,
  InvalidPaymentDecisionError,
  OrdersService,
} from "./orders.service.js";
import { InvalidOrderError, OrderConflictError } from "./orders.validation.js";
import type { PaymentEvidenceActor } from "./payment-evidence/payment-evidence.repository.js";
import {
  PaymentEvidenceAccessError,
  PaymentEvidenceConflictError,
  PaymentEvidenceRetentionConflictError,
  PaymentEvidenceService,
} from "./payment-evidence/payment-evidence.service.js";
import { PaymentEvidenceValidationError } from "./payment-evidence/payment-evidence.storage.js";
import { GatewayInternalGuard } from "./payment-evidence/gateway-internal.guard.js";

type InternalRequest = FastifyRequest & {
  headers: FastifyRequest["headers"] & {
    "x-authenticated-customer-id"?: string;
    "x-authenticated-role"?: string;
  };
};

function getPaymentEvidenceActor(request: InternalRequest): PaymentEvidenceActor {
  const customerId = request.headers["x-authenticated-customer-id"];
  const role = request.headers["x-authenticated-role"];
  if (
    typeof customerId !== "string" ||
    !customerId.trim() ||
    (role !== "CUSTOMER" && role !== "STORE_ADMIN")
  ) {
    throw new NotFoundException("Payment evidence was not found");
  }
  return { customerId, role };
}

function getStoreAdminActor(request: InternalRequest): PaymentEvidenceActor {
  const actor = getPaymentEvidenceActor(request);
  if (actor.role !== "STORE_ADMIN") {
    throw new ForbiddenException("Store administrator access is required");
  }
  return actor;
}

function multipartErrorCode(error: unknown): string | undefined {
  if (typeof error !== "object" || error === null || !("code" in error)) {
    return undefined;
  }
  return typeof error.code === "string" ? error.code : undefined;
}

@Controller()
export class OrdersController {
  public constructor(
    @Inject("ORDERS_SERVICE") private readonly orders: OrdersService,
    @Inject("PAYMENT_EVIDENCE_SERVICE")
    private readonly paymentEvidence: PaymentEvidenceService,
  ) {}

  @Get("healthz")
  public healthcheck(): { status: "ok" } {
    return { status: "ok" };
  }

  @Post("orders")
  @UseGuards(GatewayInternalGuard)
  public async createOrder(
    @Body() body: unknown,
    @Headers("idempotency-key") idempotencyKey: string | undefined,
    @Req() request: InternalRequest,
  ): Promise<{ data: Awaited<ReturnType<OrdersService["createOrder"]>> }> {
    const actor = getPaymentEvidenceActor(request);
    if (actor.role !== "CUSTOMER") {
      throw new ForbiddenException("Customer access is required");
    }

    const trustedBody =
      typeof body === "object" && body !== null && !Array.isArray(body)
        ? { ...body, customerId: actor.customerId }
        : body;
    try {
      return { data: await this.orders.createOrder(trustedBody, idempotencyKey) };
    } catch (error) {
      if (error instanceof CatalogUnavailableError) {
        throw new ServiceUnavailableException(error.message);
      }
      if (error instanceof InvalidOrderError) {
        throw new BadRequestException(error.message);
      }
      if (error instanceof OrderConflictError) {
        throw new ConflictException(error.message);
      }
      throw error;
    }
  }

  @Post("admin/payments/:orderId/reject")
  @UseGuards(GatewayInternalGuard)
  @Header("Cache-Control", "private, no-store")
  public async rejectPayment(
    @Param("orderId") orderId: string,
    @Body() body: unknown,
    @Req() request: InternalRequest,
  ): Promise<{ data: NonNullable<Awaited<ReturnType<OrdersService["getOrderById"]>>> }> {
    const actor = getStoreAdminActor(request);
    const reason =
      typeof body === "object" && body !== null && !Array.isArray(body) && "reason" in body
        ? body.reason
        : undefined;
    try {
      const { result, order } = await this.orders.rejectPayment(
        orderId,
        actor.customerId,
        reason,
      );
      if (result === "not-found" || !order) {
        throw new NotFoundException("Payment review was not found");
      }
      if (result === "not-pending" || result === "decision-conflict") {
        throw new ConflictException("Payment is no longer eligible for rejection");
      }
      return { data: order };
    } catch (error) {
      if (error instanceof InvalidOrderError || error instanceof InvalidPaymentDecisionError) {
        throw new BadRequestException(error.message);
      }
      throw error;
    }
  }

  @Get("orders/:orderId")
  @UseGuards(GatewayInternalGuard)
  public async getOrder(
    @Param("orderId") orderId: string,
    @Req() request: InternalRequest,
  ): Promise<{ data: NonNullable<Awaited<ReturnType<OrdersService["getOrderById"]>>> }> {
    const actor = getPaymentEvidenceActor(request);
    if (actor.role !== "CUSTOMER") {
      throw new NotFoundException(`Order ${orderId} not found`);
    }
    const result = await this.orders.getOrderById(orderId, actor.customerId);

    if (result === null) {
      throw new NotFoundException("Order was not found");
    }

    return { data: result };
  }

  @Post("orders/:orderId/cancel")
  @UseGuards(GatewayInternalGuard)
  @Header("Cache-Control", "private, no-store")
  public async cancelOrder(
    @Param("orderId") orderId: string,
    @Req() request: InternalRequest,
  ): Promise<{ data: NonNullable<Awaited<ReturnType<OrdersService["getOrderById"]>>> }> {
    const actor = getPaymentEvidenceActor(request);
    if (actor.role !== "CUSTOMER") {
      throw new NotFoundException("Order was not found");
    }

    try {
      const { result, order } = await this.orders.cancelOrder(orderId, actor.customerId);
      if (result === "not-found" || !order) {
        throw new NotFoundException("Order was not found");
      }
      if (result === "not-cancellable") {
        throw new ConflictException("Order is no longer eligible for cancellation");
      }
      return { data: order };
    } catch (error) {
      if (error instanceof InvalidOrderError) {
        throw new BadRequestException(error.message);
      }
      throw error;
    }
  }

  @Post("orders/:orderId/cancellation-request")
  @UseGuards(GatewayInternalGuard)
  @Header("Cache-Control", "private, no-store")
  public async requestCancellation(
    @Param("orderId") orderId: string,
    @Req() request: InternalRequest,
  ): Promise<{ data: NonNullable<Awaited<ReturnType<OrdersService["getOrderById"]>>> }> {
    const actor = getPaymentEvidenceActor(request);
    if (actor.role !== "CUSTOMER") {
      throw new NotFoundException("Order was not found");
    }
    try {
      const { result, order } = await this.orders.requestCancellation(orderId, actor.customerId);
      if (result === "not-found" || !order) {
        throw new NotFoundException("Order was not found");
      }
      if (result === "not-eligible" || result === "already-resolved") {
        throw new ConflictException("Order is no longer eligible for a cancellation request");
      }
      return { data: order };
    } catch (error) {
      if (error instanceof InvalidOrderError) {
        throw new BadRequestException(error.message);
      }
      throw error;
    }
  }

  @Get("admin/cancellation-requests")
  @UseGuards(GatewayInternalGuard)
  @Header("Cache-Control", "private, no-store")
  public async listPendingCancellationRequests(
    @Req() request: InternalRequest,
  ): Promise<{ data: Awaited<ReturnType<OrdersService["listPendingCancellationRequests"]>> }> {
    getStoreAdminActor(request);
    return { data: await this.orders.listPendingCancellationRequests() };
  }

  @Post("admin/cancellation-requests/:orderId/refund-handling")
  @UseGuards(GatewayInternalGuard)
  @Header("Cache-Control", "private, no-store")
  public async recordCancellationRefund(
    @Param("orderId") orderId: string,
    @Body() body: unknown,
    @Req() request: InternalRequest,
  ): Promise<{ data: NonNullable<Awaited<ReturnType<OrdersService["getOrderById"]>>> }> {
    const actor = getStoreAdminActor(request);
    const paymentCaptured =
      typeof body === "object" && body !== null && !Array.isArray(body) && "paymentCaptured" in body
        ? body.paymentCaptured
        : undefined;
    const externalRefundReference =
      typeof body === "object" &&
        body !== null &&
        !Array.isArray(body) &&
        "externalRefundReference" in body
        ? body.externalRefundReference
        : undefined;
    try {
      const { result, order } = await this.orders.recordCancellationRefund(
        orderId,
        actor.customerId,
        paymentCaptured,
        externalRefundReference,
      );
      if (result === "not-found" || !order) {
        throw new NotFoundException("Cancellation request was not found");
      }
      if (result === "not-pending" || result === "conflict") {
        throw new ConflictException("Cancellation request is no longer eligible for refund handling");
      }
      return { data: order };
    } catch (error) {
      if (
        error instanceof InvalidOrderError ||
        error instanceof InvalidCancellationResolutionError
      ) {
        throw new BadRequestException(error.message);
      }
      throw error;
    }
  }

  @Post("admin/cancellation-requests/:orderId/resolve")
  @UseGuards(GatewayInternalGuard)
  @Header("Cache-Control", "private, no-store")
  public async resolveCancellationRequest(
    @Param("orderId") orderId: string,
    @Body() body: unknown,
    @Req() request: InternalRequest,
  ): Promise<{ data: NonNullable<Awaited<ReturnType<OrdersService["getOrderById"]>>> }> {
    const actor = getStoreAdminActor(request);
    const action =
      typeof body === "object" && body !== null && !Array.isArray(body) && "action" in body
        ? body.action
        : undefined;
    const note =
      typeof body === "object" && body !== null && !Array.isArray(body) && "note" in body
        ? body.note
        : undefined;
    try {
      const { result, order } = await this.orders.resolveCancellationRequest(
        orderId,
        actor.customerId,
        action,
        note,
      );
      if (result === "not-found" || !order) {
        throw new NotFoundException("Cancellation request was not found");
      }
      if (result === "refund-not-recorded") {
        throw new ConflictException(
          "Record the payment capture status and any required external refund before cancelling",
        );
      }
      if (result === "not-pending" || result === "already-resolved") {
        throw new ConflictException("Cancellation request is no longer pending");
      }
      return { data: order };
    } catch (error) {
      if (
        error instanceof InvalidOrderError ||
        error instanceof InvalidCancellationResolutionError
      ) {
        throw new BadRequestException(error.message);
      }
      throw error;
    }
  }

  @Post("orders/:orderId/payment-evidence")
  @UseGuards(GatewayInternalGuard)
  public async uploadPaymentEvidence(
    @Param("orderId") orderId: string,
    @Req() request: InternalRequest,
  ): Promise<{ data: Awaited<ReturnType<PaymentEvidenceService["upload"]>> }> {
    const actor = getPaymentEvidenceActor(request);
    if (!request.isMultipart()) {
      throw new BadRequestException("A multipart payment evidence file is required");
    }

    let form: FormData;
    try {
      form = await request.formData();
    } catch (error) {
      const code = multipartErrorCode(error);
      if (code === "FST_REQ_FILE_TOO_LARGE") {
        throw new PayloadTooLargeException("Payment evidence exceeds the 10 MiB limit");
      }
      if (code?.startsWith("FST_")) {
        throw new BadRequestException("Invalid payment evidence multipart request");
      }
      throw error;
    }

    const fileEntries = form.getAll("file");
    const referenceEntries = form.getAll("transactionReference");
    if (
      fileEntries.length !== 1 ||
      !(fileEntries[0] instanceof File) ||
      referenceEntries.length > 1 ||
      Array.from(form.keys()).some(
        (key) => key !== "file" && key !== "transactionReference",
      )
    ) {
      throw new BadRequestException("Invalid payment evidence multipart fields");
    }
    const file = fileEntries[0];
    const reference = referenceEntries[0];
    if (reference !== undefined && typeof reference !== "string") {
      throw new BadRequestException("The transaction reference is invalid");
    }

    try {
      const data = await this.paymentEvidence.upload(
        orderId,
        actor,
        {
          originalFileName: file.name,
          contentType: file.type,
          bytes: new Uint8Array(await file.arrayBuffer()),
        },
        reference,
      );
      return { data };
    } catch (error) {
      if (error instanceof PaymentEvidenceValidationError) {
        throw new BadRequestException(error.message);
      }
      if (error instanceof PaymentEvidenceAccessError) {
        throw new NotFoundException(error.message);
      }
      if (error instanceof PaymentEvidenceConflictError) {
        throw new ConflictException(error.message);
      }
      throw error;
    }
  }

  @Get("orders/:orderId/payment-evidence")
  @UseGuards(GatewayInternalGuard)
  @Header("Cache-Control", "private, no-store")
  @Header("X-Content-Type-Options", "nosniff")
  public async getPaymentEvidence(
    @Param("orderId") orderId: string,
    @Req() request: InternalRequest,
  ): Promise<StreamableFile> {
    const actor = getPaymentEvidenceActor(request);
    try {
      const { metadata, stream } = await this.paymentEvidence.open(orderId, actor);
      const disposition = `attachment; filename*=UTF-8''${encodeURIComponent(metadata.originalFileName)}`;
      return new StreamableFile(stream, {
        type: metadata.contentType,
        length: metadata.sizeBytes,
        disposition,
      });
    } catch (error) {
      if (error instanceof PaymentEvidenceAccessError) {
        throw new NotFoundException(error.message);
      }
      throw error;
    }
  }

  @Get("admin/payments")
  @UseGuards(GatewayInternalGuard)
  @Header("Cache-Control", "private, no-store")
  public async listPendingPayments(
    @Req() request: InternalRequest,
  ): Promise<{
    data: Awaited<ReturnType<PaymentEvidenceService["listPendingForAdmin"]>>;
  }> {
    const actor = getStoreAdminActor(request);
    return { data: await this.paymentEvidence.listPendingForAdmin(actor) };
  }

  @Get("admin/payments/:orderId")
  @UseGuards(GatewayInternalGuard)
  @Header("Cache-Control", "private, no-store")
  public async getPendingPayment(
    @Param("orderId") orderId: string,
    @Req() request: InternalRequest,
  ): Promise<{
    data: Awaited<ReturnType<PaymentEvidenceService["getPendingForAdmin"]>>;
  }> {
    const actor = getStoreAdminActor(request);
    try {
      return {
        data: await this.paymentEvidence.getPendingForAdmin(orderId, actor),
      };
    } catch (error) {
      if (error instanceof PaymentEvidenceAccessError) {
        throw new NotFoundException(error.message);
      }
      throw error;
    }
  }

  @Post("admin/payments/:orderId/approve")
  @UseGuards(GatewayInternalGuard)
  @Header("Cache-Control", "private, no-store")
  public async approvePayment(
    @Param("orderId") orderId: string,
    @Req() request: InternalRequest,
  ): Promise<{ data: NonNullable<Awaited<ReturnType<OrdersService["getOrderById"]>>> }> {
    const actor = getStoreAdminActor(request);
    try {
      const { result, order } = await this.orders.approvePayment(orderId, actor.customerId);
      if (result === "not-found" || !order) {
        throw new NotFoundException("Payment review was not found");
      }
      if (result === "not-pending" || result === "decision-conflict") {
        throw new ConflictException("Payment is no longer eligible for approval");
      }
      return { data: order };
    } catch (error) {
      if (error instanceof InvalidOrderError) {
        throw new BadRequestException(error.message);
      }
      throw error;
    }
  }

  @Get("admin/payments/:orderId/evidence")
  @UseGuards(GatewayInternalGuard)
  @Header("Cache-Control", "private, no-store")
  @Header("X-Content-Type-Options", "nosniff")
  public async getPendingPaymentEvidence(
    @Param("orderId") orderId: string,
    @Req() request: InternalRequest,
  ): Promise<StreamableFile> {
    const actor = getStoreAdminActor(request);
    try {
      const { metadata, stream } = await this.paymentEvidence.open(orderId, actor);
      const disposition = `attachment; filename*=UTF-8''${encodeURIComponent(metadata.originalFileName)}`;
      return new StreamableFile(stream, {
        type: metadata.contentType,
        length: metadata.sizeBytes,
        disposition,
      });
    } catch (error) {
      if (error instanceof PaymentEvidenceAccessError) {
        throw new NotFoundException(error.message);
      }
      throw error;
    }
  }

  @Post("admin/payments/:orderId/evidence")
  @UseGuards(GatewayInternalGuard)
  @Header("Cache-Control", "private, no-store")
  public async deleteAdminPaymentEvidence(
    @Param("orderId") orderId: string,
    @Body() body: unknown,
    @Req() request: InternalRequest,
  ): Promise<{
    data: Awaited<ReturnType<PaymentEvidenceService["deleteAfterAdminDownload"]>>;
  }> {
    const actor = getStoreAdminActor(request);
    const confirmedDownloaded =
      typeof body === "object" && body !== null && !Array.isArray(body) &&
      "confirmDownloaded" in body
        ? body.confirmDownloaded
        : undefined;
    try {
      return {
        data: await this.paymentEvidence.deleteAfterAdminDownload(
          orderId,
          actor,
          confirmedDownloaded,
        ),
      };
    } catch (error) {
      if (error instanceof PaymentEvidenceAccessError) {
        throw new NotFoundException(error.message);
      }
      if (error instanceof PaymentEvidenceRetentionConflictError) {
        throw new ConflictException(error.message);
      }
      if (error instanceof PaymentEvidenceValidationError) {
        throw new BadRequestException(error.message);
      }
      throw error;
    }
  }

  @Post("admin/payment-evidence/:orderId/legal-hold")
  @UseGuards(GatewayInternalGuard)
  @Header("Cache-Control", "private, no-store")
  public async placePaymentEvidenceLegalHold(
    @Param("orderId") orderId: string,
    @Body() body: unknown,
    @Req() request: InternalRequest,
  ): Promise<{
    data: Awaited<ReturnType<PaymentEvidenceService["placeLegalHold"]>>;
  }> {
    const actor = getStoreAdminActor(request);
    const reason =
      typeof body === "object" && body !== null && !Array.isArray(body) && "reason" in body
        ? body.reason
        : undefined;
    try {
      return { data: await this.paymentEvidence.placeLegalHold(orderId, actor, reason) };
    } catch (error) {
      if (error instanceof PaymentEvidenceAccessError) {
        throw new NotFoundException(error.message);
      }
      if (error instanceof PaymentEvidenceRetentionConflictError) {
        throw new ConflictException(error.message);
      }
      if (error instanceof PaymentEvidenceValidationError) {
        throw new BadRequestException(error.message);
      }
      throw error;
    }
  }

  @Delete("admin/payment-evidence/:orderId/legal-hold")
  @UseGuards(GatewayInternalGuard)
  @Header("Cache-Control", "private, no-store")
  public async releasePaymentEvidenceLegalHold(
    @Param("orderId") orderId: string,
    @Body() body: unknown,
    @Req() request: InternalRequest,
  ): Promise<{
    data: Awaited<ReturnType<PaymentEvidenceService["releaseLegalHold"]>>;
  }> {
    const actor = getStoreAdminActor(request);
    const reason =
      typeof body === "object" && body !== null && !Array.isArray(body) && "reason" in body
        ? body.reason
        : undefined;
    try {
      return { data: await this.paymentEvidence.releaseLegalHold(orderId, actor, reason) };
    } catch (error) {
      if (error instanceof PaymentEvidenceAccessError) {
        throw new NotFoundException(error.message);
      }
      if (error instanceof PaymentEvidenceRetentionConflictError) {
        throw new ConflictException(error.message);
      }
      if (error instanceof PaymentEvidenceValidationError) {
        throw new BadRequestException(error.message);
      }
      throw error;
    }
  }
}
