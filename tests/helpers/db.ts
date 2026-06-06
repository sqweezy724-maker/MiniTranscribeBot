import { PrismaClient } from "@prisma/client";

export function createPrismaForDb(dbUrl: string): PrismaClient {
  return new PrismaClient({
    datasources: { db: { url: dbUrl } },
  });
}

export async function clearDatabase(prisma: PrismaClient): Promise<void> {
  await prisma.job.deleteMany();
  await prisma.user.deleteMany();
}
