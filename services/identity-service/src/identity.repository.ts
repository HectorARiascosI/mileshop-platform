import type { CustomerRecord, RefreshTokenRecord } from "./identity.types.js";

export interface CustomerRepository {
  findByEmail(email: string): Promise<CustomerRecord | null>;
  findById(id: string): Promise<CustomerRecord | null>;
  save(customer: CustomerRecord): Promise<void>;
  saveRefreshToken(token: RefreshTokenRecord): Promise<void>;
  findRefreshToken(token: string): Promise<RefreshTokenRecord | null>;
  deleteRefreshToken(token: string): Promise<void>;
  deleteRefreshTokensByCustomerId(customerId: string): Promise<void>;
}

export class InMemoryCustomerRepository implements CustomerRepository {
  private readonly customers = new Map<string, CustomerRecord>();
  private readonly byEmail = new Map<string, string>(); // email -> id
  private readonly refreshTokens = new Map<string, RefreshTokenRecord>();

  public async findByEmail(email: string): Promise<CustomerRecord | null> {
    const id = this.byEmail.get(email.toLowerCase());
    if (!id) return null;
    const record = this.customers.get(id);
    return record ? structuredClone(record) : null;
  }

  public async findById(id: string): Promise<CustomerRecord | null> {
    const record = this.customers.get(id);
    return record ? structuredClone(record) : null;
  }

  public async save(customer: CustomerRecord): Promise<void> {
    this.customers.set(customer.id, structuredClone(customer));
    this.byEmail.set(customer.email.toLowerCase(), customer.id);
  }

  public async saveRefreshToken(token: RefreshTokenRecord): Promise<void> {
    this.refreshTokens.set(token.token, structuredClone(token));
  }

  public async findRefreshToken(token: string): Promise<RefreshTokenRecord | null> {
    const record = this.refreshTokens.get(token);
    return record ? structuredClone(record) : null;
  }

  public async deleteRefreshToken(token: string): Promise<void> {
    this.refreshTokens.delete(token);
  }

  public async deleteRefreshTokensByCustomerId(customerId: string): Promise<void> {
    for (const [key, value] of this.refreshTokens.entries()) {
      if (value.customerId === customerId) {
        this.refreshTokens.delete(key);
      }
    }
  }
}
