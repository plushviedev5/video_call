import Fastify, { type FastifyInstance } from 'fastify';
import fastifyCors from '@fastify/cors';
import fastifyHelmet from '@fastify/helmet';
import { config } from './config/index.js';
import { globalErrorHandler, notFoundHandler } from './errors/error-handler.js';
import {
  requestContextMiddleware,
  responseHeadersMiddleware,
} from './middleware/request-context.middleware.js';
import { httpRequestDuration, httpRequestTotal, metricsRegistry } from './logging/metrics.js';
import { checkDatabaseHealth } from './infrastructure/db/prisma.js';
import { checkRedisHealth } from './infrastructure/redis/client.js';
import { checkQueueHealth } from './infrastructure/queue/queue.js';
import { logger } from './logging/logger.js';

// Module controllers
import { authController } from './modules/auth/auth.controller.js';
import { usersController } from './modules/users/users.controller.js';
import { meetingsController } from './modules/meetings/meetings.controller.js';
import { participantsController } from './modules/participants/participants.controller.js';
import { chatController } from './modules/chat/chat.controller.js';
import { devicesController } from './modules/devices/devices.controller.js';

// ---------------------------------------------------------------------------
// Application factory
// ---------------------------------------------------------------------------

export async function buildApp(): Promise<FastifyInstance> {
  const app = Fastify({
    logger: false, // We use our own Pino logger
    requestIdHeader: 'x-request-id',
    genReqId: () => crypto.randomUUID(),
    trustProxy: true,
  });

  // -----------------------------------------------------------------------
  // Plugins
  // -----------------------------------------------------------------------

  await app.register(fastifyCors, {
    origin: config.cors.origin,
    credentials: true,
    methods: ['GET', 'POST', 'PUT', 'PATCH', 'DELETE', 'OPTIONS'],
    allowedHeaders: ['Content-Type', 'Authorization', 'X-Request-Id'],
    exposedHeaders: ['X-Request-Id', 'X-RateLimit-Limit', 'X-RateLimit-Remaining', 'X-RateLimit-Reset'],
  });

  await app.register(fastifyHelmet, {
    contentSecurityPolicy: config.isProduction ? undefined : false,
    crossOriginEmbedderPolicy: false,
  });

  // -----------------------------------------------------------------------
  // Global hooks
  // -----------------------------------------------------------------------

  // Request context
  app.addHook('onRequest', requestContextMiddleware);
  app.addHook('onSend', responseHeadersMiddleware);

  // HTTP metrics
  app.addHook('onRequest', async (request) => {
    (request as any).__startTime = process.hrtime.bigint();
  });

  app.addHook('onResponse', async (request, reply) => {
    const startTime = (request as any).__startTime as bigint | undefined;
    if (startTime) {
      const durationNs = Number(process.hrtime.bigint() - startTime);
      const durationSec = durationNs / 1e9;
      const route = request.routeOptions?.url ?? request.url;

      httpRequestDuration.observe(
        { method: request.method, route, status_code: reply.statusCode },
        durationSec,
      );
      httpRequestTotal.inc({
        method: request.method,
        route,
        status_code: reply.statusCode,
      });

      request.log.info(
        {
          statusCode: reply.statusCode,
          durationMs: Math.round(durationSec * 1000),
        },
        'Request completed',
      );
    }
  });

  // -----------------------------------------------------------------------
  // Error handling
  // -----------------------------------------------------------------------

  app.setErrorHandler(globalErrorHandler);
  app.setNotFoundHandler(notFoundHandler);

  // -----------------------------------------------------------------------
  // Health check
  // -----------------------------------------------------------------------

  app.get('/health', async (_request, reply) => {
    const [dbHealthy, redisHealthy, queueHealthy] = await Promise.all([
      checkDatabaseHealth(),
      checkRedisHealth(),
      checkQueueHealth(),
    ]);

    const healthy = dbHealthy && redisHealthy && queueHealthy;

    const status = {
      status: healthy ? 'healthy' : 'degraded',
      timestamp: new Date().toISOString(),
      services: {
        database: dbHealthy ? 'up' : 'down',
        redis: redisHealthy ? 'up' : 'down',
        queue: queueHealthy ? 'up' : 'down',
      },
    };

    reply.status(healthy ? 200 : 503).send(status);
  });

  // -----------------------------------------------------------------------
  // Prometheus metrics endpoint
  // -----------------------------------------------------------------------

  app.get('/metrics', async (_request, reply) => {
    if (!config.metrics.enabled) {
      reply.status(404).send({ error: { code: 'NOT_FOUND', message: 'Metrics disabled', details: {} } });
      return;
    }
    const metrics = await metricsRegistry.metrics();
    reply.header('Content-Type', metricsRegistry.contentType).send(metrics);
  });

  // -----------------------------------------------------------------------
  // API routes (v1)
  // -----------------------------------------------------------------------

  await app.register(
    async (v1) => {
      await v1.register(authController, { prefix: '/auth' });
      await v1.register(usersController, { prefix: '/users' });
      await v1.register(meetingsController, { prefix: '/meetings' });
      await v1.register(participantsController, { prefix: '/participants' });
      // Chat routes are nested under meetings: /v1/meetings/:id/chat
      await v1.register(chatController, { prefix: '/meetings' });
      await v1.register(devicesController, { prefix: '/devices' });
    },
    { prefix: '/v1' },
  );

  // -----------------------------------------------------------------------
  // Ready log
  // -----------------------------------------------------------------------

  app.addHook('onReady', async () => {
    logger.info(
      {
        routes: app.printRoutes({ commonPrefix: false }),
      },
      'All routes registered',
    );
  });

  return app;
}
