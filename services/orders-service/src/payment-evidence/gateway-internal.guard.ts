import {
  CanActivate,
  ExecutionContext,
  Injectable,
  ServiceUnavailableException,
  UnauthorizedException,
  Inject,
} from "@nestjs/common";
import { timingSafeEqual } from "node:crypto";
import type { FastifyRequest } from "fastify";

export const ORDERS_INTERNAL_TOKEN = "ORDERS_INTERNAL_TOKEN";

@Injectable()
export class GatewayInternalGuard implements CanActivate {
  public constructor(
    @Inject(ORDERS_INTERNAL_TOKEN) private readonly expectedToken: string,
  ) {}

  public canActivate(context: ExecutionContext): boolean {
    if (this.expectedToken.trim().length < 32) {
      throw new ServiceUnavailableException(
        "A strong gateway-to-orders token must be configured",
      );
    }

    const request = context.switchToHttp().getRequest<FastifyRequest>();
    const providedToken = request.headers["x-orders-internal-token"];
    if (typeof providedToken !== "string") {
      throw new UnauthorizedException("Trusted gateway request is required");
    }
    const expectedBytes = Buffer.from(this.expectedToken, "utf8");
    const providedBytes = Buffer.from(providedToken, "utf8");
    if (
      expectedBytes.byteLength !== providedBytes.byteLength ||
      !timingSafeEqual(providedBytes, expectedBytes)
    ) {
      throw new UnauthorizedException("Trusted gateway request is required");
    }
    return true;
  }
}
