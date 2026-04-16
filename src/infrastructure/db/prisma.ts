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
      datasources: {
        db: { url: process.env.DATABASE_URL },
      },
    });

    // Structured query logging
    prisma.$on('query' as never, (e: { query: string; duration: number }) => {
      logger.debug({ query: e.query, durationMs: e.duration }, 'prisma.query');
    });

    // Log errors but DO NOT rethrow — prevents E57P01 / admin-kill from
    // crashing the process before the HTTP port is open.
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
// Connect with retry  (used by server.ts bootstrap)
// ---------------------------------------------------------------------------

export async function connectDatabase(retries = 5, delayMs = 3000): Promise<void> {
  const client = getPrismaClient();

  for (let attempt = 1; attempt <= retries; attempt++) {
    try {
      await Promise.race([
        client.$connect(),
        new Promise<never>((_, reject) =>
          setTimeout(() => reject(new Error('DB connect timeout (15s)')), 15_000),
        ),
      ]);
      logger.info('Database connected');
      return;
    } catch (err) {
      logger.warn({ err, attempt, retries }, `Database connection attempt ${attempt}/${retries} failed`);
      if (attempt < retries) {
        await new Promise(r => setTimeout(r, delayMs));
      }
    }
  }

  // Exhausted retries — throw so server.ts can mark readiness.db = false
  throw new Error(`Database failed to connect after ${retries} attempts`);
}

// ---------------------------------------------------------------------------
// Health check  (lightweight — just a SELECT 1)
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