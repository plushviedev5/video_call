import { Worker, Job } from 'bullmq';
import { QueueName } from '../../../config/constants.js';
import { bullConnection, type NotificationJobData } from '../queue.js';
import { logger } from '../../../logging/logger.js';

// ---------------------------------------------------------------------------
// Notification Worker
// ---------------------------------------------------------------------------
// Processes push notification jobs asynchronously.
// APNs/FCM delivery is a placeholder integration — the queueing, retry,
// and outcome tracking logic is fully real.
// ---------------------------------------------------------------------------

async function processNotification(job: Job<NotificationJobData>): Promise<void> {
  const { userId, title, body, platform, pushToken, voipToken, data } = job.data;

  const log = logger.child({
    jobId: job.id,
    userId,
    platform,
    attemptsMade: job.attemptsMade,
  });

  log.info({ title }, 'Processing push notification');

  // -----------------------------------------------------------------------
  // PLACEHOLDER INTEGRATION: Replace with actual APNs / FCM calls
  // -----------------------------------------------------------------------
  // In production, this would:
  //   1. Select the correct transport (APNs for iOS, FCM for Android/Web)
  //   2. Build the platform-specific payload
  //   3. Send via HTTP/2 (APNs) or HTTP (FCM)
  //   4. Handle device token invalidation
  //   5. Track delivery outcome
  // -----------------------------------------------------------------------

  if (!pushToken && !voipToken) {
    log.warn('No push or VoIP token available — skipping');
    return;
  }

  try {
    if (platform === 'ios' && voipToken) {
      // APNs VoIP push (for incoming call notifications)
      log.info({ voipToken: voipToken.slice(0, 8) + '...' }, 'Would send APNs VoIP push');
      // await sendAPNsVoIPPush(voipToken, { title, body, ...data });
    } else if (platform === 'ios' && pushToken) {
      // APNs standard push
      log.info({ pushToken: pushToken.slice(0, 8) + '...' }, 'Would send APNs push');
      // await sendAPNsPush(pushToken, { title, body, ...data });
    } else if (platform === 'android' && pushToken) {
      // FCM push
      log.info({ pushToken: pushToken.slice(0, 8) + '...' }, 'Would send FCM push');
      // await sendFCMPush(pushToken, { title, body, ...data });
    } else if (pushToken) {
      // Generic / web push
      log.info({ pushToken: pushToken.slice(0, 8) + '...' }, 'Would send generic push');
      // await sendWebPush(pushToken, { title, body, ...data });
    }

    log.info('Push notification processed successfully');
  } catch (error) {
    log.error({ error }, 'Push notification delivery failed');
    throw error; // BullMQ will retry based on backoff config
  }
}

// ---------------------------------------------------------------------------
// Worker initialization
// ---------------------------------------------------------------------------

let notificationWorker: Worker<NotificationJobData> | null = null;

export function startNotificationWorker(): Worker<NotificationJobData> {
  if (notificationWorker) return notificationWorker;

  notificationWorker = new Worker<NotificationJobData>(
    QueueName.NOTIFICATIONS,
    processNotification,
    {
      connection: bullConnection,
      concurrency: 5,
      limiter: {
        max: 50,
        duration: 1000, // 50 notifications per second
      },
    },
  );

  notificationWorker.on('completed', (job) => {
    logger.debug({ jobId: job.id }, 'Notification job completed');
  });

  notificationWorker.on('failed', (job, err) => {
    logger.error(
      { jobId: job?.id, error: err.message, attempts: job?.attemptsMade },
      'Notification job failed',
    );
  });

  notificationWorker.on('error', (err) => {
    logger.error({ error: err.message }, 'Notification worker error');
  });

  logger.info('Notification worker started');
  return notificationWorker;
}

export async function stopNotificationWorker(): Promise<void> {
  if (notificationWorker) {
    await notificationWorker.close();
    notificationWorker = null;
    logger.info('Notification worker stopped');
  }
}
