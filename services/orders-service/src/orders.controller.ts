import {
  BadRequestException,
  Body,
  Controller,
  Delete,
  Get,
  Headers,
  Inject,
  HttpException,
  NotFoundException,
  Param,
  Post,
  ServiceUnavailableException,
  UnauthorizedException,
  ForbiddenException,
  Header,
  Optional,
  Res,
} from "@nestjs/common";

import { CatalogUnavailableError } from "./catalog.reader.js";
import { OrdersService } from "./orders.service.js";
import type { CreateOrderInput } from "./orders.types.js";
import { ORDERS_INTERNAL_TOKEN } from "./payment-evidence/gateway-internal.guard.js";
import type { FastifyReply } from "fastify";

@Controller()
export class OrdersController {
  public constructor(
    @Inject("ORDERS_SERVICE") private readonly orders: OrdersService,
    @Optional() @Inject("PAYMENT_EVIDENCE_SERVICE") private readonly evidence?: any,
    @Optional() @Inject(ORDERS_INTERNAL_TOKEN) private readonly configuredToken?: string,
  ) {}

  private trusted(
    token: string | undefined,
    customerId: string | undefined,
    role: string | undefined,
  ): void {
    if (!token || !customerId || !role || (this.configuredToken && token !== this.configuredToken)) {
      throw new UnauthorizedException();
    }
  }

  @Get("healthz")
  public healthcheck(): { status: "ok" } {
    return { status: "ok" };
  }

  @Get("readyz")
  public readiness(): { status: "ready" } {
    return { status: "ready" };
  }

  @Post("orders")
  public async createOrder(
    @Body() body: Omit<CreateOrderInput, "idempotencyKey">,
    @Headers("idempotency-key") idempotencyKey: string | undefined,
    @Headers("x-orders-internal-token") internalToken: string | undefined,
    @Headers("x-authenticated-customer-id") customerId: string | undefined,
    @Headers("x-authenticated-role") role: string | undefined,
  ): Promise<{ data: Awaited<ReturnType<OrdersService["createOrder"]>> }> {
    if (!internalToken || !customerId || !role) throw new UnauthorizedException();
    this.trusted(internalToken, customerId, role);
    if (role !== "CUSTOMER") throw new ForbiddenException();
    try {
      return {
        data: await this.orders.createOrder({
          ...body,
          customerId,
          idempotencyKey: idempotencyKey ?? "",
        }),
      };
    } catch (error) {
      if (error instanceof CatalogUnavailableError) {
        throw new ServiceUnavailableException(error.message);
      }

      if (error instanceof HttpException) {
        throw error;
      }

      throw new BadRequestException(error instanceof Error ? error.message : "Invalid order payload");
    }
  }

  @Get("orders/:orderId")
  public async getOrder(
    @Param("orderId") orderId: string,
    @Headers("x-orders-internal-token") token: string | undefined,
    @Headers("x-authenticated-customer-id") customerId: string | undefined,
    @Headers("x-authenticated-role") role: string | undefined,
  ): Promise<{ data: NonNullable<Awaited<ReturnType<OrdersService["getOrderById"]>>> }> {
    this.trusted(token, customerId, role);
    const result = await this.orders.getOrderById(orderId);

    if (result === null) {
      throw new NotFoundException(`Order ${orderId} not found`);
    }
    if (role === "CUSTOMER" && result.customerId !== customerId) {
      throw new NotFoundException(`Order ${orderId} not found`);
    }

    return { data: result };
  }

  @Post("orders/:orderId/cancel")
  @Header("Cache-Control", "private, no-store")
  public async cancelOrder(
    @Param("orderId") orderId: string,
    @Headers("x-orders-internal-token") token: string | undefined,
    @Headers("x-authenticated-customer-id") customerId: string | undefined,
    @Headers("x-authenticated-role") role: string | undefined,
  ): Promise<unknown> {
    if (!token || !customerId || !role) throw new UnauthorizedException();
    this.trusted(token, customerId, role);
    if (role === "STORE_ADMIN") throw new NotFoundException();
    if (role !== "CUSTOMER") throw new ForbiddenException();
    const result = await this.orders.cancelOrder(orderId, customerId);
    return { data: "order" in result ? result.order : result };
  }

  @Post("orders/:orderId/cancellation-request")
  @Header("Cache-Control", "private, no-store")
  public async requestCancellation(
    @Param("orderId") orderId: string,
    @Headers("x-orders-internal-token") token: string | undefined,
    @Headers("x-authenticated-customer-id") customerId: string | undefined,
  ): Promise<unknown> {
    if (!token || !customerId) throw new UnauthorizedException();
    return { data: await this.orders.requestCancellation(orderId, customerId) };
  }

  @Post("admin/cancellation-requests/:orderId/refund-handling")
  @Header("Cache-Control", "private, no-store")
  public async recordRefund(
    @Param("orderId") orderId: string,
    @Headers("x-orders-internal-token") token: string | undefined,
    @Headers("x-authenticated-customer-id") customerId: string | undefined,
    @Headers("x-authenticated-role") role: string | undefined,
    @Body()     body: { paymentCaptured: boolean; externalRefundReference?: string | null; refundReference?: string | null },
  ): Promise<unknown> {
    if (!token || !customerId || !role) throw new UnauthorizedException();
    if (role !== "STORE_ADMIN") throw new ForbiddenException();
    return {
      data: await this.orders.recordCancellationRefund(
        orderId,
        customerId,
        body.paymentCaptured,
        body.externalRefundReference ?? body.refundReference ?? null,
      ),
    };
  }

  @Post("admin/cancellation-requests/:orderId/resolve")
  @Header("Cache-Control", "private, no-store")
  public async resolveCancellation(
    @Param("orderId") orderId: string,
    @Headers("x-orders-internal-token") token: string | undefined,
    @Headers("x-authenticated-customer-id") customerId: string | undefined,
    @Headers("x-authenticated-role") role: string | undefined,
    @Body()     body: { action?: "CANCEL" | "KEEP_OPEN"; resolution?: "CANCEL" | "KEEP_OPEN"; note?: string | null },
  ): Promise<unknown> {
    if (!token || !customerId || !role) throw new UnauthorizedException();
    if (role !== "STORE_ADMIN") throw new ForbiddenException();
    if (!body.action && !body.resolution) throw new BadRequestException("Cancellation action is required");
    return { data: await this.orders.resolveCancellationRequest(orderId, customerId, (body.action ?? body.resolution)!, body.note ?? null) };
  }

  @Get("admin/cancellation-requests")
  @Header("Cache-Control", "private, no-store")
  public async listCancellationRequests(
    @Headers("x-orders-internal-token") token: string | undefined,
    @Headers("x-authenticated-customer-id") customerId: string | undefined,
    @Headers("x-authenticated-role") role: string | undefined,
  ): Promise<unknown> {
    this.trusted(token, customerId, role);
    if (role !== "STORE_ADMIN") throw new ForbiddenException();
    return { data: await this.orders.listPendingCancellationRequests() };
  }

  @Post("orders/:orderId/payment-evidence")
  public async uploadEvidence(
    @Param("orderId") orderId: string,
    @Headers("x-orders-internal-token") token: string | undefined,
    @Headers("x-authenticated-customer-id") customerId: string | undefined,
    @Headers("x-authenticated-role") role: string | undefined,
    @Body() body: any,
  ): Promise<unknown> {
    this.trusted(token, customerId, role);
    if (role !== "CUSTOMER" || !this.evidence) throw new ForbiddenException();
    const file = body.file;
    const bytes = file?.data ?? file?.toBuffer?.() ?? Buffer.alloc(0);
    const result = await this.evidence.upload(orderId, { customerId, role }, {
      originalFileName: file.filename ?? file.name,
      contentType: file.mimetype ?? file.encoding,
      bytes: Buffer.isBuffer(bytes) ? new Uint8Array(bytes) : bytes,
    }, body.transactionReference?.value ?? body.transactionReference ?? null);
    return { data: result };
  }

  @Get("orders/:orderId/payment-evidence")
  @Header("Cache-Control", "private, no-store")
  @Header("X-Content-Type-Options", "nosniff")
  public async openEvidence(
    @Param("orderId") orderId: string,
    @Headers("x-orders-internal-token") token: string | undefined,
    @Headers("x-authenticated-customer-id") customerId: string | undefined,
    @Headers("x-authenticated-role") role: string | undefined,
    @Res() reply: FastifyReply,
  ): Promise<void> {
    this.trusted(token, customerId, role);
    const opened = await this.evidence.open(orderId, { customerId, role }, "inline");
    reply
      .header("cache-control", "private, no-store")
      .header("x-content-type-options", "nosniff")
      .header("content-disposition", `attachment; filename="${opened.metadata.originalFileName.replace(/["\\r\\n]/g, "_")}"`)
      .header("content-type", opened.metadata.contentType)
      .send(opened.stream);
  }

  @Get("admin/payments/:orderId/evidence")
  @Header("Cache-Control", "private, no-store")
  @Header("X-Content-Type-Options", "nosniff")
  public async adminEvidence(
    @Param("orderId") orderId: string,
    @Headers("x-orders-internal-token") token: string | undefined,
    @Headers("x-authenticated-customer-id") customerId: string | undefined,
    @Headers("x-authenticated-role") role: string | undefined,
    @Res() reply: FastifyReply,
  ): Promise<void> {
    this.trusted(token, customerId, role);
    if (role !== "STORE_ADMIN") throw new ForbiddenException();
    const opened = await this.evidence.open(orderId, { customerId, role }, "attachment");
    reply
      .header("cache-control", "private, no-store")
      .header("x-content-type-options", "nosniff")
      .header("content-disposition", `attachment; filename="${opened.metadata.originalFileName.replace(/["\\r\\n]/g, "_")}"`)
      .header("content-type", opened.metadata.contentType)
      .send(opened.stream);
  }

  @Post("admin/payments/:orderId/approve")
  @Header("Cache-Control", "private, no-store")
  public async approvePayment(
    @Param("orderId") orderId: string,
    @Headers("x-orders-internal-token") token: string | undefined,
    @Headers("x-authenticated-customer-id") customerId: string | undefined,
    @Headers("x-authenticated-role") role: string | undefined,
  ): Promise<unknown> {
    this.trusted(token, customerId, role);
    if (role !== "STORE_ADMIN") throw new ForbiddenException();
    const result = await this.orders.approvePayment(orderId, customerId!);
    return { data: result && typeof result === "object" && "order" in result ? result.order : result };
  }

  @Post("admin/payments/:orderId/reject")
  @Header("Cache-Control", "private, no-store")
  public async rejectPayment(
    @Param("orderId") orderId: string,
    @Headers("x-orders-internal-token") token: string | undefined,
    @Headers("x-authenticated-customer-id") customerId: string | undefined,
    @Headers("x-authenticated-role") role: string | undefined,
    @Body() body: { reason?: string },
  ): Promise<unknown> {
    this.trusted(token, customerId, role);
    if (role !== "STORE_ADMIN") throw new ForbiddenException();
    if (typeof body.reason !== "string" || body.reason.trim().length === 0) {
      throw new BadRequestException("Payment rejection reason is required");
    }
    const result = await this.orders.rejectPayment(orderId, customerId!, body.reason.trim());
    return { data: result && typeof result === "object" && "order" in result ? result.order : result };
  }

  @Get("admin/payments")
  @Header("Cache-Control", "private, no-store")
  public async listPayments(
    @Headers("x-orders-internal-token") token: string | undefined,
    @Headers("x-authenticated-customer-id") customerId: string | undefined,
    @Headers("x-authenticated-role") role: string | undefined,
  ): Promise<unknown> {
    this.trusted(token, customerId, role);
    if (role !== "STORE_ADMIN") throw new ForbiddenException();
    return { data: await this.evidence.listPendingForAdmin({ customerId: customerId!, role }) };
  }

  @Get("admin/payments/:orderId")
  @Header("Cache-Control", "private, no-store")
  public async getPayment(
    @Param("orderId") orderId: string,
    @Headers("x-orders-internal-token") token: string | undefined,
    @Headers("x-authenticated-customer-id") customerId: string | undefined,
    @Headers("x-authenticated-role") role: string | undefined,
  ): Promise<unknown> {
    this.trusted(token, customerId, role);
    if (role !== "STORE_ADMIN") throw new ForbiddenException();
    return { data: await this.evidence.getPendingForAdmin(orderId, { customerId: customerId!, role }) };
  }

  @Post("admin/payments/:orderId/evidence")
  @Header("Cache-Control", "private, no-store")
  public async deleteAdminEvidence(
    @Param("orderId") orderId: string,
    @Headers("x-orders-internal-token") token: string | undefined,
    @Headers("x-authenticated-customer-id") customerId: string | undefined,
    @Headers("x-authenticated-role") role: string | undefined,
    @Body() body: { confirmDownloaded?: boolean },
  ): Promise<unknown> {
    this.trusted(token, customerId, role);
    if (role !== "STORE_ADMIN") throw new ForbiddenException();
    try {
      return {
        data: await this.evidence.deleteAfterAdminDownload(
          orderId,
          { customerId: customerId!, role },
          body.confirmDownloaded,
        ),
      };
    } catch (error) {
      if (error instanceof Error && /confirm/i.test(error.message)) {
        throw new BadRequestException(error.message);
      }
      throw error;
    }
  }

  @Post("admin/payment-evidence/:orderId/legal-hold")
  @Header("Cache-Control", "private, no-store")
  public async placeLegalHold(
    @Param("orderId") orderId: string,
    @Headers("x-orders-internal-token") token: string | undefined,
    @Headers("x-authenticated-customer-id") customerId: string | undefined,
    @Headers("x-authenticated-role") role: string | undefined,
    @Body() body: { reason?: string },
  ): Promise<unknown> {
    this.trusted(token, customerId, role);
    if (role !== "STORE_ADMIN") throw new ForbiddenException();
    try {
      return { data: await this.evidence.placeLegalHold(orderId, { customerId: customerId!, role }, body.reason) };
    } catch (error) {
      if (error instanceof Error && /reason/i.test(error.message)) throw new BadRequestException(error.message);
      throw error;
    }
  }

  @Delete("admin/payment-evidence/:orderId/legal-hold")
  @Header("Cache-Control", "private, no-store")
  public async releaseLegalHold(
    @Param("orderId") orderId: string,
    @Headers("x-orders-internal-token") token: string | undefined,
    @Headers("x-authenticated-customer-id") customerId: string | undefined,
    @Headers("x-authenticated-role") role: string | undefined,
    @Body() body: { reason?: string },
  ): Promise<unknown> {
    this.trusted(token, customerId, role);
    if (role !== "STORE_ADMIN") throw new ForbiddenException();
    try {
      return { data: await this.evidence.releaseLegalHold(orderId, { customerId: customerId!, role }, body.reason) };
    } catch (error) {
      if (error instanceof Error && /reason/i.test(error.message)) throw new BadRequestException(error.message);
      throw error;
    }
  }
}
