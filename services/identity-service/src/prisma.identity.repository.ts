import type { CustomerRepository } from "./identity.repository.js";
import type { CustomerRecord, RefreshTokenRecord } from "./identity.types.js";
import type { PrismaService } from "./prisma.service.js";

export class PrismaCustomerRepository implements CustomerRepository {
  public constructor(private readonly prisma: PrismaService) {}

  public async findByEmail(email: string): Promise<CustomerRecord | null> {
    const row = await this.prisma.customer.findUnique({
      where: { email: email.toLowerCase() },
    });

    if (!row) return null;

    return this.toCustomerRecord(row);
  }

  public async findById(id: string): Promise<CustomerRecord | null> {
    const row = await this.prisma.customer.findUnique({
      where: { id },
    });

    if (!row) return null;

    return this.toCustomerRecord(row);
  }

  public async save(customer: CustomerRecord): Promise<void> {
    await this.prisma.customer.upsert({
      where: { id: customer.id },
      update: {
        email: customer.email,
        passwordHash: customer.passwordHash,
        name: customer.name,
        phone: customer.phone ?? null,
        updatedAt: customer.updatedAt,
      },
      create: {
        id: customer.id,
        email: customer.email,
        passwordHash: customer.passwordHash,
        name: customer.name,
        phone: customer.phone ?? null,
        createdAt: customer.createdAt,
        updatedAt: customer.updatedAt,
      },
    });
  }

  public async saveRefreshToken(token: RefreshTokenRecord): Promise<void> {
    await this.prisma.refreshToken.create({
      data: {
        id: token.id,
        token: token.token,
        customerId: token.customerId,
        expiresAt: token.expiresAt,
        createdAt: token.createdAt,
      },
    });
  }

  public async findRefreshToken(token: string): Promise<RefreshTokenRecord | null> {
    const row = await this.prisma.refreshToken.findUnique({
      where: { token },
    });

    if (!row) return null;

    return this.toRefreshTokenRecord(row);
  }

  public async deleteRefreshToken(token: string): Promise<void> {
    await this.prisma.refreshToken.deleteMany({
      where: { token },
    });
  }

  public async deleteRefreshTokensByCustomerId(customerId: string): Promise<void> {
    await this.prisma.refreshToken.deleteMany({
      where: { customerId },
    });
  }

  private toCustomerRecord(row: {
    id: string;
    email: string;
    passwordHash: string;
    name: string;
    phone: string | null;
    createdAt: Date;
    updatedAt: Date;
  }): CustomerRecord {
    return {
      id: row.id,
      email: row.email,
      passwordHash: row.passwordHash,
      name: row.name,
      phone: row.phone ?? undefined,
      createdAt: row.createdAt,
      updatedAt: row.updatedAt,
    };
  }

  private toRefreshTokenRecord(row: {
    id: string;
    token: string;
    customerId: string;
    expiresAt: Date;
    createdAt: Date;
  }): RefreshTokenRecord {
    return {
      id: row.id,
      token: row.token,
      customerId: row.customerId,
      expiresAt: row.expiresAt,
      createdAt: row.createdAt,
    };
  }
}
