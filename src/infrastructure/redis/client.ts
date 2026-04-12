import { Redis } from 'ioredis';
import { config } from '../../config/index.js';
import { logger } from '../../logging/logger.js';

// ---------------------------------------------------------------------------
// Redis client factory
// ---------------------------------------------------------------------------

function createRedisClient(purpose: string): Redis {
  const client = new Redis({
    host: config.redis.host,
    port: config.redis.port,
    password: config.redis.password,
    db: config.redis.db,
    tls: config.redis.tls ? {} : undefined,
    maxRetriesPerRequest: 3,
    retryStrategy(times: number) {
      const delay = Math.min(times * 200, 5000);
      logger.warn({ times, delay, purpose }, 'Redis reconnecting');
      return delay;
    },
    enableReadyCheck: true,
    lazyConnect: true,
  });

  client.on('connect', () => {
    logger.info({ purpose }, 'Redis connected');
  });

  client.on('error', (err: Error) => {
    logger.error({ error: err.message, purpose }, 'Redis error');
  });

  client.on('close', () => {
    logger.warn({ purpose }, 'Redis connection closed');
  });

  return client;
}

// ---------------------------------------------------------------------------
// Client instances
// ---------------------------------------------------------------------------

/** Primary client for reads/writes */
export const redis = createRedisClient('primary');

/** Dedicated pub-sub subscriber (cannot share with command client) */
export const redisSub = createRedisClient('subscriber');

/** Dedicated pub-sub publisher */
export const redisPub = createRedisClient('publisher');

// ---------------------------------------------------------------------------
// Connection management
// ---------------------------------------------------------------------------

export async function connectRedis(): Promise<void> {
  await Promise.all([redis.connect(), redisSub.connect(), redisPub.connect()]);
  logger.info('All Redis clients connected');
}

export async function disconnectRedis(): Promise<void> {
  await Promise.all([redis.quit(), redisSub.quit(), redisPub.quit()]);
  logger.info('All Redis clients disconnected');
}

// ---------------------------------------------------------------------------
// Health check
// ---------------------------------------------------------------------------

export async function checkRedisHealth(): Promise<boolean> {
  try {
    const pong = await redis.ping();
    return pong === 'PONG';
  } catch (error) {
    logger.error({ error }, 'Redis health check failed');
    return false;
  }
}
