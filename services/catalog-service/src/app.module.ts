import { Module } from "@nestjs/common";
import { PrismaClient } from "../generated/catalog-client/index.js";

import {
  CatalogService,
  InMemoryCatalogStore,
} from "./catalog.service.js";
import { CatalogController } from "./catalog.controller.js";
import { PrismaCatalogStore } from "./prisma.catalog.store.js";
import { PrismaService } from "./prisma.service.js";

@Module({
  controllers: [CatalogController],
  providers: [
    InMemoryCatalogStore,
    PrismaService,
    {
      provide: "PRISMA_CLIENT",
      inject: [PrismaService],
      useFactory: (prisma: PrismaService) =>
        process.env.DATABASE_URL ? prisma : null,
    },
    {
      provide: "CATALOG_STORE",
      inject: ["PRISMA_CLIENT", InMemoryCatalogStore],
      useFactory: (prisma: PrismaService | null, inMemoryStore: InMemoryCatalogStore) =>
        prisma ? new PrismaCatalogStore(prisma) : inMemoryStore,
    },
    {
      provide: "CATALOG_SERVICE",
      inject: ["CATALOG_STORE"],
      useFactory: (store: InMemoryCatalogStore) => new CatalogService(store),
    },
  ],
})
export class AppModule {}
