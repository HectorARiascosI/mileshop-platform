import "reflect-metadata";

import helmet from "@fastify/helmet";
import rateLimit from "@fastify/rate-limit";
import { NestFactory } from "@nestjs/core";
import { FastifyAdapter, type NestFastifyApplication } from "@nestjs/platform-fastify";
import type { FastifyRequest } from "fastify";

import { AppModule } from "./app.module.js";

const port = Number(process.env["PORT"] ?? 3040);

if (!process.env["JWT_SECRET"] && process.env["NODE_ENV"] === "production") {
  throw new Error("JWT_SECRET is required in production");
}

if (!process.env["JWT_SECRET"]) {
  console.warn("[identity-service] WARNING: JWT_SECRET is not set. Using empty string — do not use in production.");
}

const allowedOrigins: string | string[] =
  process.env["ALLOWED_ORIGINS"]?.split(",").map((o) => o.trim()).filter(Boolean) ?? "*";

async function bootstrap(): Promise<void> {
  const app = await NestFactory.create<NestFastifyApplication>(
    AppModule,
    new FastifyAdapter(),
  );

  app.enableCors({
    origin: allowedOrigins,
    methods: ["GET", "POST", "OPTIONS"],
    allowedHeaders: ["Content-Type", "Authorization"],
    credentials: true,
  });

  app.enableShutdownHooks();

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

  await app.listen(port, "0.0.0.0");
  console.info(`identity-service listening on ${port}`);
}

void bootstrap();
