import { Controller, Get, Inject } from "@nestjs/common";

import { CatalogService } from "./catalog.service.js";

@Controller()
export class CatalogController {
  public constructor(
    @Inject("CATALOG_SERVICE") private readonly catalog: CatalogService,
  ) {}

  @Get("healthz")
  public healthcheck(): { status: "ok" } {
    return { status: "ok" };
  }

  @Get("products")
  public async products(): Promise<{ data: Awaited<ReturnType<CatalogService["listProducts"]>> }> {
    return { data: await this.catalog.listProducts() };
  }
}
