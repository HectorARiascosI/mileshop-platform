import type { FastifyInstance } from "fastify";
import type { IncomingMessage, ServerResponse } from "node:http";

import { createApplication } from "../dist/app.js";
import { handleFastifyRequest } from "../../../packages/vercel-fastify-adapter/src/index.js";

let fastifyPromise: Promise<FastifyInstance> | undefined;

async function getFastify(): Promise<FastifyInstance> {
  fastifyPromise ??= (async () => {
    const application = await createApplication();
    await application.init();
    return application.getHttpAdapter().getInstance();
  })();
  return fastifyPromise;
}

export default async function handler(
  request: IncomingMessage,
  response: ServerResponse,
): Promise<void> {
  await handleFastifyRequest(await getFastify(), request, response);
}
