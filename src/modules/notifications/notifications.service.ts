import * as devicesRepo from '../devices/devices.repository.js';
import { notificationQueue, type NotificationJobData } from '../../infrastructure/queue/queue.js';
import { logger } from '../../logging/logger.js';

const log = logger.child({ module: 'notifications.service' });

// ---------------------------------------------------------------------------
// Notification Service
// ---------------------------------------------------------------------------
// All notification sending is asynchronous via BullMQ.
// This service enqueues jobs and never blocks the caller.
// ---------------------------------------------------------------------------

/**
 * Send a push notification to a specific user.
 * Looks up all user devices and queues a notification for each.
 */
export async function notifyUser(
  userId: string,
  title: string,
  body: string,
  data?: Record<string, string>,
): Promise<void> {
  try {
    const devices = await devicesRepo.getDevicesByUser(userId);

    if (devices.length === 0) {
      log.debug({ userId }, 'No devices found for user — skipping notification');
      return;
    }

    const jobs = devices.map((device) => ({
      name: `notify-${device.id}`,
      data: {
        userId,
        title,
        body,
        data,
        platform: device.platform as NotificationJobData['platform'],
        pushToken: device.pushToken ?? undefined,
        voipToken: device.voipToken ?? undefined,
      } satisfies NotificationJobData,
    }));

    await notificationQueue.addBulk(jobs);

    log.info(
      { userId, deviceCount: devices.length },
      'Push notifications queued',
    );
  } catch (error) {
    // Never throw — notifications must not break the calling flow
    log.error({ error, userId }, 'Failed to queue push notifications');
  }
}

/**
 * Send a VoIP call notification (high priority, used for incoming call alerts).
 */
export async function notifyIncomingCall(
  userId: string,
  callerName: string,
  meetingId: string,
  meetingCode: string,
): Promise<void> {
  await notifyUser(userId, 'Incoming Call', `${callerName} is calling you`, {
    type: 'incoming_call',
    meetingId,
    meetingCode,
    callerName,
  });
}

/**
 * Notify all participants in a meeting.
 */
export async function notifyMeetingParticipants(
  participantUserIds: string[],
  title: string,
  body: string,
  data?: Record<string, string>,
  excludeUserId?: string,
): Promise<void> {
  const targets = excludeUserId
    ? participantUserIds.filter((id) => id !== excludeUserId)
    : participantUserIds;

  await Promise.all(targets.map((userId) => notifyUser(userId, title, body, data)));
}
