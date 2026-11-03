import { ConflictException, NotFoundException } from "@nestjs/common";
import type { CustomerRepository } from "./identity.repository.js";
import type { CustomerRecord, RefreshTokenRecord } from "./identity.types.js";
import type { PrismaService } from "./prisma.service.js";

const INITIAL_OWNER_BOOTSTRAP_ID = "initial-owner";

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
        role: customer.role,
        updatedAt: customer.updatedAt,
      },
      create: {
        id: customer.id,
        email: customer.email,
        passwordHash: customer.passwordHash,
        name: customer.name,
        phone: customer.phone ?? null,
        role: customer.role,
        createdAt: customer.createdAt,
        updatedAt: customer.updatedAt,
      },
    });
  }

  public async bootstrapInitialAdmin(email: string): Promise<CustomerRecord> {
    try {
      return await this.prisma.$transaction(async (transaction) => {
        const customer = await transaction.customer.findUnique({
          where: { email: email.trim().toLowerCase() },
        });
        if (!customer) {
          throw new NotFoundException("Customer account not found");
        }

        const existingOwner = await transaction.ownerBootstrap.findUnique({
          where: { id: INITIAL_OWNER_BOOTSTRAP_ID },
        });
        const existingAdmins = await transaction.customer.count({
          where: { role: "STORE_ADMIN" },
        });
        if (existingOwner || existingAdmins > 0) {
          throw new ConflictException("Initial store admin has already been provisioned");
        }

        await transaction.ownerBootstrap.create({
          data: {
            id: INITIAL_OWNER_BOOTSTRAP_ID,
            customerId: customer.id,
          },
        });
        const updatedCustomer = await transaction.customer.update({
          where: { id: customer.id },
          data: { role: "STORE_ADMIN" },
        });
        return this.toCustomerRecord(updatedCustomer);
      });
    } catch (error) {
      if (this.isUniqueConstraintError(error)) {
        throw new ConflictException("Initial store admin has already been provisioned");
      }
      throw error;
    }
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
    role: "CUSTOMER" | "STORE_ADMIN";
    createdAt: Date;
    updatedAt: Date;
  }): CustomerRecord {
    return {
      id: row.id,
      email: row.email,
      passwordHash: row.passwordHash,
      name: row.name,
      phone: row.phone ?? undefined,
      role: row.role,
      createdAt: row.createdAt,
      updatedAt: row.updatedAt,
    };
  }

  private isUniqueConstraintError(error: unknown): boolean {
    return (
      typeof error === "object" &&
      error !== null &&
      "code" in error &&
      error.code === "P2002"
    );
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
