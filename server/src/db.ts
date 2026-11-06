import { PrismaPg } from '@prisma/adapter-pg';
import { PrismaClient, Prisma } from './generated/prisma/client.ts';
import { config } from './config.ts';

export const db = new PrismaClient({
  adapter: new PrismaPg({ connectionString: config.databaseUrl }),
});

export type Tx = Prisma.TransactionClient;
export { Prisma };
