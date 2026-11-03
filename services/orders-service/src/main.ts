import "reflect-metadata";

import { createApplication } from "./app.js";

const port = Number(process.env.PORT ?? 3030);
const catalogServiceUrl = process.env.CATALOG_SERVICE_URL ?? "http://localhost:3020";

async function bootstrap(): Promise<void> {
  const app = await createApplication();
  app.enableShutdownHooks();
  await app.listen(port, "0.0.0.0");
  console.info(`orders-service listening on ${port}; catalog=${catalogServiceUrl}`);
}

void bootstrap();
