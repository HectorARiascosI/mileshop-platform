import "reflect-metadata";

import helmet from "@fastify/helmet";
import multipart from "@fastify/multipart";
import rateLimit from "@fastify/rate-limit";
import { NestFactory } from "@nestjs/core";
import {
  FastifyAdapter,
  type NestFastifyApplication,
} from "@nestjs/platform-fastify";
import type { FastifyRequest } from "fastify";

import { AppModule } from "./app.module.js";

export async function createApplication(): Promise<NestFastifyApplication> {
  const requiredInProduction = [
    "DATABASE_URL",
    "CATALOG_SERVICE_URL",
    "CATALOG_RESERVATION_TOKEN",
    "CATALOG_INVENTORY_COMMAND_TOKEN",
    "ORDERS_INTERNAL_TOKEN",
    "NOTIFICATION_WORKER_URL",
    "CRON_SECRET",
  ];
  const missing = requiredInProduction.filter((name) => !process.env[name]?.trim());
  if (process.env.NODE_ENV === "production" && missing.length > 0) {
    throw new Error(`Missing required production environment variables: ${missing.join(", ")}`);
  }
  const requiredSecrets = [
    "CATALOG_RESERVATION_TOKEN",
    "CATALOG_INVENTORY_COMMAND_TOKEN",
    "ORDERS_INTERNAL_TOKEN",
    "CRON_SECRET",
  ];
  const weakSecrets = requiredSecrets.filter(
    (name) => (process.env[name]?.trim().length ?? 0) < 32,
  );
  if (process.env.NODE_ENV === "production" && weakSecrets.length > 0) {
    throw new Error(`Production secrets must contain at least 32 characters: ${weakSecrets.join(", ")}`);
  }

  const app = await NestFactory.create<NestFastifyApplication>(
    AppModule,
    new FastifyAdapter(),
  );
  await app.register(multipart, {
    attachFieldsToBody: true,
    throwFileSizeLimit: true,
    limits: {
      fileSize: 4 * 1024 * 1024,
      files: 1,
      fields: 1,
      parts: 2,
    },
  });

  const allowedOrigins = (process.env.ALLOWED_ORIGINS ?? "http://localhost:3000")
    .split(",")
    .map((origin) => origin.trim())
    .filter(Boolean);

  app.enableCors({
    origin: allowedOrigins,
    methods: ["GET", "POST", "OPTIONS"],
    allowedHeaders: ["Content-Type", "Authorization"],
    credentials: true,
  });

  await (app as any).register(helmet as any, {
    global: true,
    contentSecurityPolicy: false,
  });
  await (app as any).register(rateLimit as any, {
    global: true,
    max: Number(process.env.RATE_LIMIT_MAX ?? 120),
    timeWindow: "1 minute",
    keyGenerator: (request: FastifyRequest) => request.ip ?? "unknown",
    errorResponseBuilder: (_request: FastifyRequest, context: { after: number }) => ({
      statusCode: 429,
      error: "Too Many Requests",
      message: "Rate limit exceeded. Try again later.",
      retryAfter: context.after,
    }),
  });

  return app;
}
