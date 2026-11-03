import "reflect-metadata";

import helmet from "@fastify/helmet";
import rateLimit from "@fastify/rate-limit";
import { NestFactory } from "@nestjs/core";
import {
  FastifyAdapter,
  type NestFastifyApplication,
} from "@nestjs/platform-fastify";
import type { FastifyRequest } from "fastify";

import { AppModule } from "./app.module.js";

export async function createApplication(): Promise<NestFastifyApplication> {
  const requiredInProduction = ["DATABASE_URL", "JWT_SECRET"];
  const missing = requiredInProduction.filter((name) => !process.env[name]?.trim());
  if (process.env.NODE_ENV === "production" && missing.length > 0) {
    throw new Error(`Missing required production environment variables: ${missing.join(", ")}`);
  }
  if (
    process.env.NODE_ENV === "production" &&
    (process.env.JWT_SECRET?.trim().length ?? 0) < 32
  ) {
    throw new Error("JWT_SECRET must contain at least 32 characters in production");
  }

  if (!process.env["JWT_SECRET"]) {
    console.warn("[identity-service] WARNING: JWT_SECRET is not set. Using empty string — do not use in production.");
  }

  const app = await NestFactory.create<NestFastifyApplication>(
    AppModule,
    new FastifyAdapter(),
  );
  const allowedOrigins: string | string[] =
    process.env["ALLOWED_ORIGINS"]?.split(",").map((origin) => origin.trim()).filter(Boolean) ?? "*";

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
    max: 120,
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
