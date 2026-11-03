import {
  BadRequestException,
  ConflictException,
  Inject,
  Injectable,
  ServiceUnavailableException,
  UnauthorizedException,
} from "@nestjs/common";

import { IDENTITY_SERVICE_URL } from "./auth.middleware.js";

export const IDENTITY_FETCH = "IDENTITY_FETCH";

type FetchLike = (input: string, init?: RequestInit) => Promise<Response>;

@Injectable()
export class IdentityClient {
  public constructor(
    @Inject(IDENTITY_FETCH) private readonly fetcher: FetchLike,
    @Inject(IDENTITY_SERVICE_URL) private readonly baseUrl: string,
  ) {}

  public async register(body: unknown): Promise<unknown> {
    return this.proxy("POST", "auth/register", undefined, body, [409]);
  }

  public async login(body: unknown): Promise<unknown> {
    return this.proxy("POST", "auth/login", undefined, body, [401]);
  }

  public async refresh(body: unknown): Promise<unknown> {
    return this.proxy("POST", "auth/refresh", undefined, body, [401]);
  }

  public async logout(body: unknown): Promise<void> {
    await this.proxy("POST", "auth/logout", undefined, body, []);
  }

  public async getMe(authorization: string): Promise<unknown> {
    return this.proxy("GET", "auth/me", authorization, undefined, [401]);
  }

  private async proxy(
    method: string,
    path: string,
    authorization: string | undefined,
    body: unknown,
    clientErrorStatuses: number[],
  ): Promise<unknown> {
    const headers: Record<string, string> = { "content-type": "application/json" };
    if (authorization) {
      headers["authorization"] = authorization;
    }

    let res: Response;
    try {
      res = await this.fetcher(`${this.baseUrl}/${path}`, {
        method,
        headers,
        body: body !== undefined ? JSON.stringify(body) : undefined,
        signal: AbortSignal.timeout(3_000),
      });
    } catch {
      throw new ServiceUnavailableException("Identity service unavailable");
    }

    if (res.ok || res.status === 204) {
      if (res.status === 204) return;
      return res.json();
    }

    if (clientErrorStatuses.includes(res.status)) {
      const err = await res.json().catch(() => ({ message: "Request rejected" })) as { message?: string };
      if (res.status === 401) throw new UnauthorizedException(err.message ?? "Unauthorized");
      if (res.status === 409) throw new ConflictException(err.message ?? "Conflict");
      if (res.status === 400) throw new BadRequestException(err.message ?? "Bad request");
    }

    throw new ServiceUnavailableException("Identity service unavailable");
  }
}
