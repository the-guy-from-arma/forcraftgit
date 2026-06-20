import { PrismaClient } from "@prisma/client";

let prisma: PrismaClient | null = null;

export function getPrisma() {
  if (!prisma) {
    prisma = new PrismaClient({
      log: process.env.PRISMA_LOG === "true" ? ["query", "error", "warn"] : ["error"]
    });
  }

  return prisma;
}
