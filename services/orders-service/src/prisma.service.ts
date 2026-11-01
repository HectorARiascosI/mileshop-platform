import { Injectable, OnModuleDestroy } from "@nestjs/common";
import { PrismaNeon } from "@prisma/adapter-neon";
import { PrismaClient } from "../generated/orders-client/index.js";

@Injectable()
export class PrismaService extends PrismaClient implements OnModuleDestroy {
  public constructor() {
    const databaseUrl = process.env.DATABASE_URL;
    const adapter =
      process.env.VERCEL && databaseUrl && new URL(databaseUrl).hostname.endsWith(".neon.tech")
        ? new PrismaNeon({ connectionString: databaseUrl, max: 1 })
        : undefined;
    super(adapter ? { adapter } : {});
  }

  public async onModuleDestroy(): Promise<void> {
    await this.$disconnect();
  }
}
