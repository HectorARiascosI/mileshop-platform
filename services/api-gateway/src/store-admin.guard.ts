import {
  CanActivate,
  ExecutionContext,
  ForbiddenException,
  Injectable,
  UnauthorizedException,
} from "@nestjs/common";
import type { FastifyRequest } from "fastify";

import type { CustomerRole } from "./auth.middleware.js";

type VerifiedRequest = FastifyRequest["raw"] & {
  customerId?: string;
  role?: CustomerRole;
};

type RequestWithRaw = {
  raw?: VerifiedRequest;
};

@Injectable()
export class StoreAdminGuard implements CanActivate {
  public canActivate(context: ExecutionContext): boolean {
    const request = context.switchToHttp().getRequest<RequestWithRaw>();
    const verifiedRequest = request.raw;

    if (!verifiedRequest?.customerId || !verifiedRequest.role) {
      throw new UnauthorizedException("Authenticated customer is required");
    }
    if (verifiedRequest.role !== "STORE_ADMIN") {
      throw new ForbiddenException("Store administrator access is required");
    }

    return true;
  }
}
