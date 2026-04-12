import { Worker, Job } from 'bullmq';
import { QueueName } from '../../../config/constants.js';
import { bullConnection, type AuditJobData } from '../queue.js';
import { getPrismaClient } from '../../db/prisma.js';
import { logger } from '../../../logging/logger.js';
import type { Prisma } from '@prisma/client';

// ---------------------------------------------------------------------------
// Audit Worker
// ---------------------------------------------------------------------------
// Persists audit log entries asynchronously to keep request latency low.
// ---------------------------------------------------------------------------

async function processAuditLog(job: Job<AuditJobData>): Promise<void> {
  const { actorUserId, meetingId, eventType, payload, ipAddress, userAgent } = job.data;

  const log = logger.child({ jobId: job.id, eventType });

  try {
    const prisma = getPrismaClient();

    await prisma.auditLog.create({
      data: {
        actorUserId,
        meetingId,
        eventType,
        payload: (payload ?? {}) as Prisma.InputJsonValue,
        ipAddress: ipAddress ?? null,
        userAgent: userAgent ?? null,
      },
    });

    log.debug('Audit log persisted');
  } catch (error) {
    log.error({ error }, 'Failed to persist audit log');
    throw error; // BullMQ will retry
  }
}

// ---------------------------------------------------------------------------
// Worker initialization
// ---------------------------------------------------------------------------

let auditWorker: Worker<AuditJobData> | null = null;

export function startAuditWorker(): Worker<AuditJobData> {
  if (auditWorker) return auditWorker;

  auditWorker = new Worker<AuditJobData>(QueueName.AUDIT, processAuditLog, {
    connection: bullConnection,
    concurrency: 10,
    limiter: {
      max: 100,
      duration: 1000, // 100 audit logs per second
    },
  });

  auditWorker.on('completed', (job) => {
    logger.debug({ jobId: job.id }, 'Audit job completed');
  });

  auditWorker.on('failed', (job, err) => {
    logger.error(
      { jobId: job?.id, error: err.message, attempts: job?.attemptsMade },
      'Audit job failed',
    );
  });

  auditWorker.on('error', (err) => {
    logger.error({ error: err.message }, 'Audit worker error');
  });

  logger.info('Audit worker started');
  return auditWorker;
}

export async function stopAuditWorker(): Promise<void> {
  if (auditWorker) {
    await auditWorker.close();
    auditWorker = null;
    logger.info('Audit worker stopped');
  }
}
