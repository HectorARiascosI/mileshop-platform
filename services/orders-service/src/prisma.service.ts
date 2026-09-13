import { Injectable, OnModuleDestroy } from "@nestjs/common";
import { PrismaClient } from "../generated/orders-client/index.js";

@Injectable()
export class PrismaService extends PrismaClient implements OnModuleDestroy {
  public async onModuleDestroy(): Promise<void> {
    await this.$disconnect();
  }
}
