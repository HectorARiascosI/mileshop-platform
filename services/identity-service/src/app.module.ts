import { Module } from "@nestjs/common";
import { IdentityController } from "./identity.controller.js";
import { IdentityService } from "./identity.service.js";
import { InMemoryCustomerRepository } from "./identity.repository.js";
import type { CustomerRepository } from "./identity.repository.js";
import { PrismaCustomerRepository } from "./prisma.identity.repository.js";
import { PrismaService } from "./prisma.service.js";

@Module({
  controllers: [IdentityController],
  providers: [
    PrismaService,
    InMemoryCustomerRepository,
    {
      provide: "CUSTOMER_REPOSITORY",
      inject: [PrismaService, InMemoryCustomerRepository],
      useFactory: (prisma: PrismaService, inMemory: InMemoryCustomerRepository): CustomerRepository =>
        process.env["DATABASE_URL"] ? new PrismaCustomerRepository(prisma) : inMemory,
    },
    {
      provide: "IDENTITY_SERVICE",
      inject: ["CUSTOMER_REPOSITORY"],
      useFactory: (repo: CustomerRepository) =>
        new IdentityService(repo, {
          jwtSecret: process.env["JWT_SECRET"] ?? "",
          jwtExpiresIn: process.env["JWT_EXPIRES_IN"] ?? "15m",
          refreshTokenExpiresDays: Number(process.env["REFRESH_TOKEN_EXPIRES_DAYS"] ?? 30),
        }),
    },
  ],
})
export class AppModule {}
