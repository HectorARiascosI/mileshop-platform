import { PrismaClient } from "../generated/catalog-client/index.js";

const prisma = new PrismaClient();

const products = [
  {
    sku: "MILE-MUG-001",
    name: "Taza de ceramica",
    description: "Una taza sencilla para empezar bien el dia.",
    priceCop: 28000,
    stock: 24,
  },
  {
    sku: "MILE-BAG-001",
    name: "Bolso de lona",
    description: "Ligero, resistente y listo para acompañarte.",
    priceCop: 76000,
    stock: 12,
  },
  {
    sku: "MILE-NOTE-001",
    name: "Cuaderno de notas",
    description: "Papel de calidad para tus ideas y planes.",
    priceCop: 19000,
    stock: 38,
  },
];

async function seed(): Promise<void> {
  for (const product of products) {
    await prisma.product.upsert({
      where: { sku: product.sku },
      update: product,
      create: product,
    });
  }

  console.info(`Seeded ${products.length} catalog products`);
}

seed()
  .catch((error: unknown) => {
    console.error(error);
    process.exitCode = 1;
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
