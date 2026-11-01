import "reflect-metadata";

import { NestFactory } from "@nestjs/core";
import {
  FastifyAdapter,
  type NestFastifyApplication,
} from "@nestjs/platform-fastify";

import { AppModule } from "./app.module.js";

export async function createApplication(): Promise<NestFastifyApplication> {
  const requiredInProduction = ["DATABASE_URL", "NOTIFICATION_SENDER_MODE"];
  const missing = requiredInProduction.filter((name) => !process.env[name]?.trim());
  if (process.env.NODE_ENV === "production" && missing.length > 0) {
    throw new Error(`Missing required production environment variables: ${missing.join(", ")}`);
  }
  if (
    process.env.NODE_ENV === "production" &&
    process.env.NOTIFICATION_SENDER_MODE === "webhook" &&
    !process.env.NOTIFICATION_WEBHOOK_URL?.trim()
  ) {
    throw new Error("NOTIFICATION_WEBHOOK_URL is required in webhook mode");
  }

  return NestFactory.create<NestFastifyApplication>(
    AppModule,
    new FastifyAdapter(),
  );
}
