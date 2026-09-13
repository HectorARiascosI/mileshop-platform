import { Controller, Get } from "@nestjs/common";

import { CatalogClient } from "./catalog.client.js";

@Controller()
export class GatewayController {
  public constructor(private readonly catalog: CatalogClient) {}

  @Get("healthz")
  public healthcheck(): { status: "ok" } {
    return { status: "ok" };
  }

  @Get("catalog/products")
  public async products(): Promise<{ data: Awaited<ReturnType<CatalogClient["listProducts"]>> }> {
    return { data: await this.catalog.listProducts() };
  }
}
