import { PrismaClient } from '@prisma/client';
import { logger } from '../../logging/logger.js';

// ---------------------------------------------------------------------------
// Singleton Prisma client with query logging in development
// ---------------------------------------------------------------------------

let prisma: PrismaClient;

export function getPrismaClient(): PrismaClient {
  if (!prisma) {
    prisma = new PrismaClient({
      log: [
        { level: 'query', emit: 'event' },
        { level: 'error', emit: 'event' },
        { level: 'warn', emit: 'event' },
      ],
    });

    // Structured query logging
    prisma.$on('query' as never, (e: { query: string; duration: number }) => {
      logger.debug({ query: e.query, durationMs: e.duration }, 'prisma.query');
    });

    prisma.$on('error' as never, (e: { message: string }) => {
      logger.error({ error: e.message }, 'prisma.error');
    });

    prisma.$on('warn' as never, (e: { message: string }) => {
      logger.warn({ warning: e.message }, 'prisma.warn');
    });
  }

  return prisma;
}

// ---------------------------------------------------------------------------
// Health check
// ---------------------------------------------------------------------------

export async function checkDatabaseHealth(): Promise<boolean> {
  try {
    await getPrismaClient().$queryRaw`SELECT 1`;
    return true;
  } catch (error) {
    logger.error({ error }, 'Database health check failed');
    return false;
  }
}

// ---------------------------------------------------------------------------
// Graceful disconnect
// ---------------------------------------------------------------------------

export async function disconnectDatabase(): Promise<void> {
  if (prisma) {
    await prisma.$disconnect();
    logger.info('Database disconnected');
  }
}
