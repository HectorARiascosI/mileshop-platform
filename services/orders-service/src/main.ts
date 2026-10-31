import "reflect-metadata";

import helmet from "@fastify/helmet";
import multipart from "@fastify/multipart";
import rateLimit from "@fastify/rate-limit";
import { NestFactory } from "@nestjs/core";
import { FastifyAdapter, type NestFastifyApplication } from "@nestjs/platform-fastify";
import type { FastifyRequest } from "fastify";

import { AppModule } from "./app.module.js";

const port = Number(process.env.PORT ?? 3030);
const catalogServiceUrl = process.env.CATALOG_SERVICE_URL ?? "http://localhost:3020";
const allowedOrigins = (process.env.ALLOWED_ORIGINS ?? "http://localhost:3000")
  .split(",")
  .map((origin) => origin.trim())
  .filter(Boolean);

async function bootstrap(): Promise<void> {
  const app = await NestFactory.create<NestFastifyApplication>(
    AppModule,
    new FastifyAdapter(),
  );
  await app.register(multipart, {
    attachFieldsToBody: true,
    throwFileSizeLimit: true,
    limits: {
      fileSize: 10 * 1024 * 1024,
      files: 1,
      fields: 1,
      parts: 2,
    },
  });

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

  await app.listen(port, "0.0.0.0");
  console.info(`orders-service listening on ${port}; catalog=${catalogServiceUrl}`);
}

void bootstrap();
