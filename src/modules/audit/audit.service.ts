import { auditQueue, type AuditJobData } from '../../infrastructure/queue/queue.js';
import type { AuditEventType } from '../../config/constants.js';
import { logger } from '../../logging/logger.js';

const log = logger.child({ module: 'audit.service' });

// ---------------------------------------------------------------------------
// Audit Service
// ---------------------------------------------------------------------------
// Provides a clean interface for recording audit events.
// All persistence is asynchronous via BullMQ queue.
// ---------------------------------------------------------------------------

/**
 * Record an audit event asynchronously.
 * This should never throw or block the calling flow.
 */
export async function recordEvent(params: {
  actorUserId: string | null;
  meetingId?: string | null;
  eventType: AuditEventType;
  payload?: Record<string, unknown>;
  ipAddress?: string;
  userAgent?: string;
}): Promise<void> {
  try {
    const jobData: AuditJobData = {
      actorUserId: params.actorUserId,
      meetingId: params.meetingId ?? null,
      eventType: params.eventType,
      payload: params.payload ?? {},
      ipAddress: params.ipAddress,
      userAgent: params.userAgent,
      timestamp: new Date().toISOString(),
    };

    await auditQueue.add(`audit-${params.eventType}`, jobData);

    log.debug(
      { eventType: params.eventType, actorUserId: params.actorUserId },
      'Audit event queued',
    );
  } catch (error) {
    // Never throw — audit must not break the calling flow
    log.error(
      { error, eventType: params.eventType },
      'Failed to queue audit event',
    );
  }
}
