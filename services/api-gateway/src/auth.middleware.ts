import {
  Inject,
  Injectable,
  NestMiddleware,
  ServiceUnavailableException,
  UnauthorizedException,
} from "@nestjs/common";
import type { FastifyRequest, FastifyReply } from "fastify";

export const IDENTITY_SERVICE_URL = "IDENTITY_SERVICE_URL";

export type CustomerRole = "CUSTOMER" | "STORE_ADMIN";

@Injectable()
export class AuthMiddleware implements NestMiddleware {
  public constructor(
    @Inject("AUTH_FETCH") private readonly fetcher: typeof fetch,
    @Inject(IDENTITY_SERVICE_URL) private readonly identityServiceUrl: string,
  ) {}

  public async use(
    req: FastifyRequest["raw"] & {
      customerId?: string;
      email?: string;
      role?: CustomerRole;
    },
    _res: FastifyReply["raw"],
    next: () => void,
  ): Promise<void> {
    const authHeader = (req.headers as Record<string, string>)["authorization"] ?? "";
    if (!authHeader.startsWith("Bearer ")) {
      throw new UnauthorizedException("Missing authorization token");
    }

    const token = authHeader.slice(7).trim();
    if (!token) {
      throw new UnauthorizedException("Missing authorization token");
    }

    let response: Response;

    try {
      response = await this.fetcher(`${this.identityServiceUrl}/auth/me`, {
        headers: { authorization: `Bearer ${token}` },
        signal: AbortSignal.timeout(3_000),
      });
    } catch {
      throw new ServiceUnavailableException("Identity service unavailable");
    }

    if (response.status === 401) {
      throw new UnauthorizedException("Invalid or expired token");
    }
    if (!response.ok) {
      throw new ServiceUnavailableException("Identity service unavailable");
    }

    let body: unknown;
    try {
      body = await response.json();
    } catch {
      throw new ServiceUnavailableException("Identity service returned an invalid response");
    }

    if (
      !body ||
      typeof body !== "object" ||
      !("customerId" in body) ||
      typeof body.customerId !== "string" ||
      !body.customerId ||
      !("email" in body) ||
      typeof body.email !== "string" ||
      !("role" in body) ||
      (body.role !== "CUSTOMER" && body.role !== "STORE_ADMIN")
    ) {
      throw new ServiceUnavailableException("Identity service returned an invalid response");
    }

    req.customerId = body.customerId;
    req.email = body.email;
    req.role = body.role;
    next();
  }
}
