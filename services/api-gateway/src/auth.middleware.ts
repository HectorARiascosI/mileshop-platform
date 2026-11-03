import {
  Inject,
  Injectable,
  NestMiddleware,
  UnauthorizedException,
} from "@nestjs/common";
import type { FastifyReply, FastifyRequest } from "fastify";

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
    const authHeader = this.getHeaderValue(
      req.headers as Record<string, string | string[] | undefined>,
      "authorization",
    );

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
        headers: { authorization: authHeader },
        signal: AbortSignal.timeout(3_000),
      });
    } catch {
      throw new UnauthorizedException("Identity service unavailable");
    }

    if (!response.ok) {
      throw new UnauthorizedException("Invalid or expired token");
    }

    const body = (await response.json()) as {
      customerId: string;
      email: string;
      name: string;
      role: CustomerRole;
    };

    req.customerId = body.customerId;
    req.email = body.email;
    req.role = body.role;
    next();
  }

  private getHeaderValue(
    headers: Record<string, string | string[] | undefined>,
    name: string,
  ): string {
    const value = headers[name];
    if (Array.isArray(value)) {
      return value[0] ?? "";
    }

    return typeof value === "string" ? value : "";
  }
}
