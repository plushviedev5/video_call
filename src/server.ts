import { createServer } from 'http';
import { buildApp } from './app.js';
import { config } from './config/index.js';
import { logger } from './logging/logger.js';
import { getPrismaClient, disconnectDatabase } from './infrastructure/db/prisma.js';
import { connectRedis, disconnectRedis } from './infrastructure/redis/client.js';
import { closeQueues } from './infrastructure/queue/queue.js';
import { startNotificationWorker, stopNotificationWorker } from './infrastructure/queue/workers/notification.worker.js';
import { startAuditWorker, stopAuditWorker } from './infrastructure/queue/workers/audit.worker.js';
import { initializeSignalingGateway } from './modules/signaling/signaling.gateway.js';

// ---------------------------------------------------------------------------
// Readiness state — checked by /health
// ---------------------------------------------------------------------------

export const readiness = {
  db: false,
  redis: false,
};

// ---------------------------------------------------------------------------
// Bootstrap
// ---------------------------------------------------------------------------

async function bootstrap(): Promise<void> {
  logger.info({ env: config.env }, 'Starting video calling backend...');

  // 1. Build Fastify app
  const app = await buildApp();

  // 2. Create HTTP server and attach Socket.IO
  const httpServer = createServer(app.server);
  const io = initializeSignalingGateway(httpServer);
  (app as any).io = io;

  // 3. Listen FIRST — Render needs to see an open port immediately
  await app.ready();

  await new Promise<void>((resolve, reject) => {
    httpServer.listen(config.server.port, config.server.host, resolve);
    httpServer.once('error', reject);
  });

  logger.info(
    { address: `http://${config.server.host}:${config.server.port}`, env: config.env },
    '🚀 Server is running',
  );

  // 4. Connect infrastructure in the background — do NOT block the port
  connectInfrastructure().catch((err) => {
    logger.error({ err }, 'Infrastructure connection error after startup');
  });

  // -----------------------------------------------------------------------
  // Graceful shutdown
  // -----------------------------------------------------------------------

  const shutdown = async (signal: string): Promise<void> => {
    logger.info({ signal }, 'Shutdown signal received');

    io.close();
    logger.info('Socket.IO server closed');

    await new Promise<void>((resolve) => httpServer.close(() => resolve()));
    logger.info('HTTP server closed');

    await Promise.all([stopNotificationWorker(), stopAuditWorker()]);
    await closeQueues();
    await disconnectRedis();
    await disconnectDatabase();

    logger.info('Graceful shutdown complete');
    process.exit(0);
  };

  process.on('SIGTERM', () => shutdown('SIGTERM'));
  process.on('SIGINT', () => shutdown('SIGINT'));

  process.on('unhandledRejection', (reason, promise) => {
    logger.error({ reason, promise: String(promise) }, 'Unhandled rejection');
  });

  process.on('uncaughtException', (error) => {
    logger.fatal({ error }, 'Uncaught exception — shutting down');
    shutdown('uncaughtException').catch(() => process.exit(1));
  });
}

// ---------------------------------------------------------------------------
// Background infrastructure setup (runs after the port is already open)
// ---------------------------------------------------------------------------

async function connectInfrastructure(): Promise<void> {
  // --- PostgreSQL ---
  logger.info('Connecting to database...');
  const prisma = getPrismaClient();
  try {
    await Promise.race([
      prisma.$connect(),
      new Promise((_, reject) =>
        setTimeout(() => reject(new Error('Database connection timeout (15s)')), 15_000),
      ),
    ]);
    readiness.db = true;
    logger.info('Database connected');
  } catch (error) {
    logger.error({ error }, 'Could not connect to database — service is degraded');
    // Let Render's health-check (which reads `readiness.db`) surface the failure
    // instead of crashing the whole process and losing the open port.
  }

  // --- Redis ---
  logger.info('Connecting to Redis...');
  try {
    await Promise.race([
      connectRedis(),
      new Promise((_, reject) =>
        setTimeout(() => reject(new Error('Redis connection timeout (10s)')), 10_000),
      ),
    ]);
    readiness.redis = true;
    logger.info('Redis connected');
  } catch (error) {
    logger.error({ error }, 'Could not connect to Redis — service is degraded');
  }

  // --- BullMQ workers (need Redis to be up first) ---
  if (readiness.redis) {
    logger.info('Starting queue workers...');
    startNotificationWorker();
    startAuditWorker();
    logger.info('Queue workers started');
  } else {
    logger.warn('Skipping queue workers — Redis unavailable');
  }
}

// ---------------------------------------------------------------------------
// Run
// ---------------------------------------------------------------------------

bootstrap().catch((error) => {
  logger.fatal({ error }, 'Failed to bootstrap application');
  process.exit(1);
});