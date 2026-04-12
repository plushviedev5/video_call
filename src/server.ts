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
// Bootstrap
// ---------------------------------------------------------------------------

async function bootstrap(): Promise<void> {
  logger.info({ env: config.env }, 'Starting video calling backend...');

  // 1. Connect to infrastructure
  logger.info('Connecting to database...');
  const prisma = getPrismaClient();
  await prisma.$connect();
  logger.info('Database connected');

  logger.info('Connecting to Redis...');
  await connectRedis();
  logger.info('Redis connected');

  // 2. Start queue workers
  logger.info('Starting queue workers...');
  startNotificationWorker();
  startAuditWorker();
  logger.info('Queue workers started');

  // 3. Build Fastify app
  const app = await buildApp();

  // 4. Create HTTP server and attach Socket.IO
  const httpServer = createServer(app.server);
  const io = initializeSignalingGateway(httpServer);

  // Make io accessible if needed
  (app as any).io = io;

  // 5. Start listening
  await app.ready();

  httpServer.listen(config.server.port, config.server.host, () => {
    logger.info(
      {
        address: `http://${config.server.host}:${config.server.port}`,
        env: config.env,
      },
      '🚀 Server is running',
    );
  });

  httpServer.on('error', (err: Error) => {
    logger.fatal({ error: err }, 'Failed to start server');
    process.exit(1);
  });

  // -----------------------------------------------------------------------
  // Graceful shutdown
  // -----------------------------------------------------------------------

  const shutdown = async (signal: string): Promise<void> => {
    logger.info({ signal }, 'Shutdown signal received');

    // 1. Stop accepting new connections
    httpServer.close(() => {
      logger.info('HTTP server closed');
    });

    // 2. Close Socket.IO (gracefully disconnect all sockets)
    io.close();
    logger.info('Socket.IO server closed');

    // 3. Stop queue workers (let current jobs finish)
    await Promise.all([stopNotificationWorker(), stopAuditWorker()]);

    // 4. Close queues
    await closeQueues();

    // 5. Disconnect Redis
    await disconnectRedis();

    // 6. Disconnect database
    await disconnectDatabase();

    logger.info('Graceful shutdown complete');
    process.exit(0);
  };

  process.on('SIGTERM', () => shutdown('SIGTERM'));
  process.on('SIGINT', () => shutdown('SIGINT'));

  // Unhandled rejection / uncaught exception
  process.on('unhandledRejection', (reason, promise) => {
    logger.error({ reason, promise: String(promise) }, 'Unhandled rejection');
  });

  process.on('uncaughtException', (error) => {
    logger.fatal({ error }, 'Uncaught exception — shutting down');
    shutdown('uncaughtException').catch(() => process.exit(1));
  });
}

// ---------------------------------------------------------------------------
// Run
// ---------------------------------------------------------------------------

bootstrap().catch((error) => {
  logger.fatal({ error }, 'Failed to bootstrap application');
  process.exit(1);
});
