import { PrismaCustomerRepository } from "./prisma.identity.repository.js";
import { PrismaService } from "./prisma.service.js";

async function bootstrapInitialOwner(email: string): Promise<void> {
  const prisma = new PrismaService();
  try {
    await prisma.$connect();
    const owner = await new PrismaCustomerRepository(prisma).bootstrapInitialAdmin(email);
    console.info(`Initial store admin provisioned for ${owner.email}.`);
  } finally {
    await prisma.$disconnect();
  }
}

const emailArgument = process.argv[2]?.trim();
if (process.argv.length !== 3 || !emailArgument) {
  console.error("Usage: npm run admin:bootstrap -- <existing-owner-email>");
  process.exitCode = 2;
} else {
  void bootstrapInitialOwner(emailArgument).catch((error: unknown) => {
    console.error(
      "Initial store admin bootstrap failed:",
      error instanceof Error ? error.message : String(error),
    );
    process.exitCode = 1;
  });
}
