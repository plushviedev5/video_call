import { Queue, type ConnectionOptions } from 'bullmq';
import { config } from '../../config/index.js';
import { QueueName } from '../../config/constants.js';
import { logger } from '../../logging/logger.js';

// ---------------------------------------------------------------------------
// BullMQ connection options
// ---------------------------------------------------------------------------

export const bullConnection: ConnectionOptions = {
  host: config.bull.redis.host,
  port: config.bull.redis.port,
  password: config.bull.redis.password,
  tls: config.bull.redis.tls ? {} : undefined,
};

// ---------------------------------------------------------------------------
// Queue type definitions
// ---------------------------------------------------------------------------

export interface NotificationJobData {
  userId: string;
  title: string;
  body: string;
  data?: Record<string, string>;
  platform?: 'ios' | 'android' | 'web';
  pushToken?: string;
  voipToken?: string;
}

export interface AuditJobData {
  actorUserId: string | null;
  meetingId: string | null;
  eventType: string;
  payload: Record<string, unknown>;
  ipAddress?: string;
  userAgent?: string;
  timestamp: string;
}

// ---------------------------------------------------------------------------
// Queue instances
// ---------------------------------------------------------------------------

export const notificationQueue = new Queue<NotificationJobData>(
  QueueName.NOTIFICATIONS,
  {
    connection: bullConnection,
    defaultJobOptions: {
      removeOnComplete: { count: 1000 },
      removeOnFail: { count: 5000 },
      attempts: 3,
      backoff: {
        type: 'exponential',
        delay: 2000,
      },
    },
  },
);

export const auditQueue = new Queue<AuditJobData>(QueueName.AUDIT, {
  connection: bullConnection,
  defaultJobOptions: {
    removeOnComplete: { count: 5000 },
    removeOnFail: { count: 10000 },
    attempts: 5,
    backoff: {
      type: 'exponential',
      delay: 1000,
    },
  },
});

// ---------------------------------------------------------------------------
// Queue health check
// ---------------------------------------------------------------------------

export async function checkQueueHealth(): Promise<boolean> {
  try {
    await notificationQueue.getJobCounts();
    await auditQueue.getJobCounts();
    return true;
  } catch (error) {
    logger.error({ error }, 'Queue health check failed');
    return false;
  }
}

// ---------------------------------------------------------------------------
// Graceful shutdown
// ---------------------------------------------------------------------------

export async function closeQueues(): Promise<void> {
  await Promise.all([notificationQueue.close(), auditQueue.close()]);
  logger.info('All queues closed');
}
