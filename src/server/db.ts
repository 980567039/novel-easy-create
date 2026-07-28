import { PrismaPg } from "@prisma/adapter-pg";
import { PrismaClient } from "@prisma/client";

const globalForDatabase = globalThis as unknown as {
  prisma?: PrismaClient;
};

export function getDatabase(): PrismaClient {
  if (globalForDatabase.prisma) return globalForDatabase.prisma;

  const connectionString = process.env.DATABASE_URL?.trim();
  if (!connectionString) {
    throw new Error("缺少 DATABASE_URL，无法连接小说项目数据库");
  }

  const adapter = new PrismaPg({ connectionString });
  const client = new PrismaClient({
    adapter,
    log: process.env.NODE_ENV === "development" ? ["warn", "error"] : ["error"],
  });

  // Keep one pool per server process. This is required in production too;
  // otherwise every API request would create a new PostgreSQL pool.
  globalForDatabase.prisma = client;
  return client;
}
