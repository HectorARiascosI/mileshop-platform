import "reflect-metadata";

import { createApplication } from "./app.js";

const port = Number(process.env.PORT ?? 3020);

async function bootstrap(): Promise<void> {
  const app = await createApplication();
  app.enableShutdownHooks();
  await app.listen(port, "0.0.0.0");
  console.info(`catalog-service listening on ${port}`);
}

void bootstrap();
