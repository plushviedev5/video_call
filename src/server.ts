import { createServer } from 'http';
import { buildApp } from './app.js';
import { config } from './config/index.js';
import { logger } from './logging/logger.js';
import { connectDatabase, disconnectDatabase } from './infrastructure/db/prisma.js';
import { connectRedis, disconnectRedis } from './infrastructure/redis/client.js';
import { closeQueues } from './infrastructure/queue/queue.js';
import { startNotificationWorker, stopNotificationWorker } from './infrastructure/queue/workers/notification.worker.js';
import { startAuditWorker, stopAuditWorker } from './infrastructure/queue/workers/audit.worker.js';
import { initializeSignalingGateway } from './modules/signaling/signaling.gateway.js';

// ---------------------------------------------------------------------------
// Readiness state — read by app.ts /health and /ready routes
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

  // 3. Bind the port FIRST — Render must see an open port or it sends SIGTERM.
  //    Infrastructure connects in the background after this point.
  await app.ready();

  await new Promise<void>((resolve, reject) => {
    httpServer.listen(config.server.port, config.server.host, resolve);
    httpServer.once('error', reject);
  });

  logger.info(
    { address: `http://${config.server.host}:${config.server.port}`, env: config.env },
    '🚀 Server is running',
  );

  // 4. Connect infrastructure in the background
  connectInfrastructure().catch((err) => {
    logger.error({ err }, 'Unexpected error in connectInfrastructure');
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
  // --- PostgreSQL (5 attempts, 3 s apart) ---
  try {
    await connectDatabase(5, 3_000);
    readiness.db = true;
  } catch (err) {
    logger.error({ err }, 'Database unavailable — service running in degraded mode');
  }

  // --- Redis (5 attempts, 2 s apart) ---
  try {
    await connectWithRetry('Redis', connectRedis, 5, 2_000);
    readiness.redis = true;
  } catch (err) {
    logger.error({ err }, 'Redis unavailable — service running in degraded mode');
  }

  // --- BullMQ workers (require Redis) ---
  if (readiness.redis) {
    logger.info('Starting queue workers...');
    startNotificationWorker();
    startAuditWorker();
    logger.info('Queue workers started');
  } else {
    logger.warn('Skipping queue workers — Redis unavailable');
  }
}

async function connectWithRetry(
  name: string,
  fn: () => Promise<void>,
  retries = 5,
  delayMs = 2_000,
): Promise<void> {
  for (let attempt = 1; attempt <= retries; attempt++) {
    try {
      await fn();
      return;
    } catch (err) {
      logger.warn({ err, attempt, retries }, `${name} connection attempt ${attempt}/${retries} failed`);
      if (attempt < retries) await new Promise(r => setTimeout(r, delayMs));
    }
  }
  throw new Error(`${name} failed to connect after ${retries} attempts`);
}

// ---------------------------------------------------------------------------
// Run
// ---------------------------------------------------------------------------

bootstrap().catch((error) => {
  logger.fatal({ error }, 'Failed to bootstrap application');
  process.exit(1);
});