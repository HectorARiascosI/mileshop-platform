import {
  BadRequestException,
  Body,
  Controller,
  Get,
  Headers,
  HttpCode,
  Inject,
  Post,
  UnauthorizedException,
} from "@nestjs/common";
import { ZodError } from "zod";
import {
  loginSchema,
  logoutSchema,
  refreshSchema,
  registerSchema,
} from "./identity.validation.js";
import type { IdentityService } from "./identity.service.js";

@Controller()
export class IdentityController {
  public constructor(
    @Inject("IDENTITY_SERVICE") private readonly identity: IdentityService,
  ) {}

  @Get("healthz")
  public healthcheck(): { status: string; service: string } {
    return { status: "ok", service: "identity-service" };
  }

  @Post("auth/register")
  public async register(
    @Body() body: unknown,
  ): Promise<{ customerId: string; email: string; name: string; accessToken: string; refreshToken: string }> {
    const parsed = this.parse(registerSchema, body);
    const result = await this.identity.register(parsed);
    return {
      customerId: result.customerId,
      email: result.email,
      name: result.name,
      accessToken: result.accessToken,
      refreshToken: result.refreshToken,
    };
  }

  @Post("auth/login")
  @HttpCode(200)
  public async login(
    @Body() body: unknown,
  ): Promise<{ customerId: string; email: string; name: string; accessToken: string; refreshToken: string }> {
    const parsed = this.parse(loginSchema, body);
    const result = await this.identity.login(parsed);
    return {
      customerId: result.customerId,
      email: result.email,
      name: result.name,
      accessToken: result.accessToken,
      refreshToken: result.refreshToken,
    };
  }

  @Post("auth/refresh")
  @HttpCode(200)
  public async refresh(
    @Body() body: unknown,
  ): Promise<{ accessToken: string; refreshToken: string }> {
    const parsed = this.parse(refreshSchema, body);
    return this.identity.refresh(parsed.refreshToken);
  }

  @Post("auth/logout")
  @HttpCode(204)
  public async logout(@Body() body: unknown): Promise<void> {
    const parsed = this.parse(logoutSchema, body);
    await this.identity.logout(parsed.refreshToken);
  }

  @Get("auth/me")
  public async getMe(
    @Headers("authorization") authorization: string | undefined,
  ): Promise<{ customerId: string; email: string; name: string; phone?: string }> {
    if (!authorization) {
      throw new UnauthorizedException("Missing Authorization header");
    }
    const token = authorization.replace(/^Bearer\s+/i, "");
    return this.identity.getMe(token);
  }

  private parse<T>(schema: { parse: (data: unknown) => T }, data: unknown): T {
    try {
      return schema.parse(data);
    } catch (error) {
      if (error instanceof ZodError) {
        throw new BadRequestException(error.issues.map((i) => i.message).join("; "));
      }
      throw error;
    }
  }
}
