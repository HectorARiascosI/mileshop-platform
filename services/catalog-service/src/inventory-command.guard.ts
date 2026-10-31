import { createHash, timingSafeEqual } from "node:crypto";
import {
  Injectable,
  ServiceUnavailableException,
  UnauthorizedException,
  type CanActivate,
  type ExecutionContext,
} from "@nestjs/common";

@Injectable()
export class InventoryCommandGuard implements CanActivate {
  public canActivate(context: ExecutionContext): boolean {
    const expectedToken = process.env.CATALOG_INVENTORY_COMMAND_TOKEN;
    if (!expectedToken) {
      throw new ServiceUnavailableException(
        "Catalog inventory command authentication is not configured",
      );
    }

    const request = context.switchToHttp().getRequest<{
      headers: Record<string, string | string[] | undefined>;
    }>();
    const authorization = request.headers.authorization;
    if (typeof authorization !== "string" || !authorization.startsWith("Bearer ")) {
      throw new UnauthorizedException("Invalid inventory command credentials");
    }

    const suppliedToken = authorization.slice("Bearer ".length);
    const expectedDigest = createHash("sha256").update(expectedToken).digest();
    const suppliedDigest = createHash("sha256").update(suppliedToken).digest();
    if (!timingSafeEqual(expectedDigest, suppliedDigest)) {
      throw new UnauthorizedException("Invalid inventory command credentials");
    }
    return true;
  }
}
