import crypto from "node:crypto";
import { ConflictException, UnauthorizedException } from "@nestjs/common";
import jwt from "jsonwebtoken";
import { IdentityDomain } from "./identity.domain.js";
import type { CustomerRepository } from "./identity.repository.js";
import type {
  AuthResult,
  AuthTokens,
  CustomerRecord,
  CustomerView,
  LoginCommand,
  RefreshTokenRecord,
  RegisterCommand,
} from "./identity.types.js";

interface IdentityServiceConfig {
  jwtSecret: string;
  jwtExpiresIn: string;
  refreshTokenExpiresDays: number;
}

export class IdentityService {
  public constructor(
    private readonly repo: CustomerRepository,
    private readonly config: IdentityServiceConfig,
  ) {}

  public async register(command: RegisterCommand): Promise<AuthResult> {
    const existing = await this.repo.findByEmail(command.email);
    if (existing !== null) {
      throw new ConflictException("Email already registered");
    }

    const passwordHash = await IdentityDomain.hashPassword(command.password);

    const customer: CustomerRecord = {
      id: crypto.randomUUID(),
      email: command.email.toLowerCase(),
      passwordHash,
      name: command.name,
      phone: command.phone,
      createdAt: new Date(),
      updatedAt: new Date(),
    };

    await this.repo.save(customer);

    const tokens = await this.issueTokens(customer);

    return {
      ...tokens,
      customerId: customer.id,
      email: customer.email,
      name: customer.name,
    };
  }

  public async login(command: LoginCommand): Promise<AuthResult> {
    const customer = await this.repo.findByEmail(command.email);
    if (customer === null) {
      throw new UnauthorizedException("Invalid credentials");
    }

    const valid = await IdentityDomain.verifyPassword(command.password, customer.passwordHash);
    if (!valid) {
      throw new UnauthorizedException("Invalid credentials");
    }

    const tokens = await this.issueTokens(customer);

    return {
      ...tokens,
      customerId: customer.id,
      email: customer.email,
      name: customer.name,
    };
  }

  public async refresh(refreshToken: string): Promise<AuthTokens> {
    const tokenRecord = await this.repo.findRefreshToken(refreshToken);
    if (tokenRecord === null) {
      throw new UnauthorizedException("Invalid refresh token");
    }

    if (tokenRecord.expiresAt <= new Date()) {
      throw new UnauthorizedException("Refresh token expired");
    }

    await this.repo.deleteRefreshToken(refreshToken);

    const customer = await this.repo.findById(tokenRecord.customerId);
    if (customer === null) {
      throw new UnauthorizedException("Customer not found");
    }

    return this.issueTokens(customer);
  }

  public async logout(refreshToken: string): Promise<void> {
    await this.repo.deleteRefreshToken(refreshToken);
  }

  public async getMe(accessToken: string): Promise<CustomerView> {
    const payload = await new Promise<jwt.JwtPayload>((resolve, reject) => {
      jwt.verify(accessToken, this.config.jwtSecret, (err, decoded) => {
        if (err !== null || decoded === undefined) {
          reject(new UnauthorizedException("Invalid access token"));
          return;
        }
        if (typeof decoded === "string") {
          reject(new UnauthorizedException("Invalid access token"));
          return;
        }
        resolve(decoded);
      });
    });

    const sub = payload["sub"];
    if (typeof sub !== "string") {
      throw new UnauthorizedException("Invalid access token");
    }

    const customer = await this.repo.findById(sub);
    if (customer === null) {
      throw new UnauthorizedException("Customer not found");
    }

    return IdentityDomain.buildCustomerView(customer);
  }

  private async issueTokens(customer: CustomerRecord): Promise<AuthTokens> {
    const accessToken = await new Promise<string>((resolve, reject) => {
      jwt.sign(
        { sub: customer.id, email: customer.email },
        this.config.jwtSecret,
        { expiresIn: this.config.jwtExpiresIn as jwt.SignOptions["expiresIn"], algorithm: "HS256" },
        (err, token) => {
          if (err !== null || token === undefined) {
            reject(err ?? new Error("Failed to sign token"));
            return;
          }
          resolve(token);
        },
      );
    });

    const refreshToken = IdentityDomain.generateRefreshToken();

    const tokenRecord: RefreshTokenRecord = {
      id: crypto.randomUUID(),
      token: refreshToken,
      customerId: customer.id,
      expiresAt: new Date(Date.now() + this.config.refreshTokenExpiresDays * 24 * 60 * 60 * 1000),
      createdAt: new Date(),
    };

    await this.repo.saveRefreshToken(tokenRecord);

    return { accessToken, refreshToken };
  }
}
