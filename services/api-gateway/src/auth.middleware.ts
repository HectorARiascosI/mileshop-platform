import { Injectable, NestMiddleware, UnauthorizedException, Inject } from "@nestjs/common";
import type { FastifyRequest, FastifyReply } from "fastify";

export const IDENTITY_SERVICE_URL = "IDENTITY_SERVICE_URL";

@Injectable()
export class AuthMiddleware implements NestMiddleware {
  public constructor(
    @Inject("AUTH_FETCH") private readonly fetcher: typeof fetch,
    @Inject(IDENTITY_SERVICE_URL) private readonly identityServiceUrl: string,
  ) {}

  public async use(
    req: FastifyRequest["raw"] & { customerId?: string; email?: string },
    _res: FastifyReply["raw"],
    next: () => void,
  ): Promise<void> {
    const authHeader = (req.headers as Record<string, string>)["authorization"] ?? "";
    if (!authHeader.startsWith("Bearer ")) {
      throw new UnauthorizedException("Missing authorization token");
    }

    const token = authHeader.slice(7).trim();
    let response: Response;

    try {
      response = await this.fetcher(`${this.identityServiceUrl}/auth/me`, {
        headers: { authorization: `Bearer ${token}` },
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
    };

    req.customerId = body.customerId;
    req.email = body.email;
    next();
  }
}
