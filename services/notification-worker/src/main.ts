import "reflect-metadata";

import { NestFactory } from "@nestjs/core";
import {
	FastifyAdapter,
	type NestFastifyApplication,
} from "@nestjs/platform-fastify";

import { AppModule } from "./app.module.js";

const port = Number(process.env.PORT ?? 3010);

async function bootstrap(): Promise<void> {
	const app = await NestFactory.create<NestFastifyApplication>(
		AppModule,
		new FastifyAdapter(),
	);
	app.enableShutdownHooks();
	await app.listen(port, "0.0.0.0");
	console.info(`notification-worker listening on ${port}`);
}

void bootstrap();
