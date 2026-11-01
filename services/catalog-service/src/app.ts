import "reflect-metadata";

import { NestFactory } from "@nestjs/core";
import {
  FastifyAdapter,
  type NestFastifyApplication,
} from "@nestjs/platform-fastify";

import { AppModule } from "./app.module.js";

export async function createApplication(): Promise<NestFastifyApplication> {
  const requiredInProduction = [
    "DATABASE_URL",
    "CATALOG_RESERVATION_TOKEN",
    "CATALOG_INVENTORY_COMMAND_TOKEN",
  ];
  const missing = requiredInProduction.filter((name) => !process.env[name]?.trim());
  if (process.env.NODE_ENV === "production" && missing.length > 0) {
    throw new Error(`Missing required production environment variables: ${missing.join(", ")}`);
  }
  const weakSecrets = [
    "CATALOG_RESERVATION_TOKEN",
    "CATALOG_INVENTORY_COMMAND_TOKEN",
  ].filter((name) => (process.env[name]?.trim().length ?? 0) < 32);
  if (process.env.NODE_ENV === "production" && weakSecrets.length > 0) {
    throw new Error(`Production secrets must contain at least 32 characters: ${weakSecrets.join(", ")}`);
  }

  return NestFactory.create<NestFastifyApplication>(
    AppModule,
    new FastifyAdapter(),
  );
}
