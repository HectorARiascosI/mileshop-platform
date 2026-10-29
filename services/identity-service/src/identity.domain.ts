import crypto from "node:crypto";
import bcrypt from "bcryptjs";
import type { CustomerRecord } from "./identity.types.js";

const BCRYPT_ROUNDS = 12;

export class IdentityDomain {
  public static async hashPassword(password: string): Promise<string> {
    return bcrypt.hash(password, BCRYPT_ROUNDS);
  }

  public static async verifyPassword(password: string, hash: string): Promise<boolean> {
    return bcrypt.compare(password, hash);
  }

  public static generateRefreshToken(): string {
    return crypto.randomBytes(64).toString("hex");
  }

  public static buildCustomerView(record: CustomerRecord): {
    customerId: string;
    email: string;
    name: string;
    phone?: string;
  } {
    return {
      customerId: record.id,
      email: record.email,
      name: record.name,
      ...(record.phone !== undefined && { phone: record.phone }),
    };
  }
}
