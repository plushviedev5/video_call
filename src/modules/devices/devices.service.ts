import { ErrorCode, AuditEvent, Limits } from '../../config/constants.js';
import * as devicesRepo from './devices.repository.js';
import { auditQueue } from '../../infrastructure/queue/queue.js';
import { logger } from '../../logging/logger.js';
import type { ServiceResult } from '../../common/types.js';
import { success, failure } from '../../common/types.js';

const log = logger.child({ module: 'devices.service' });

// ---------------------------------------------------------------------------
// Device DTO
// ---------------------------------------------------------------------------

export interface DeviceDTO {
  id: string;
  platform: string;
  deviceName: string | null;
  appVersion: string | null;
  createdAt: Date;
  updatedAt: Date;
}

// ---------------------------------------------------------------------------
// Register / update device
// ---------------------------------------------------------------------------

export async function registerDevice(
  userId: string,
  data: {
    platform: string;
    deviceName?: string;
    pushToken?: string;
    voipToken?: string;
    appVersion?: string;
  },
  meta?: { ipAddress?: string; userAgent?: string },
): Promise<ServiceResult<DeviceDTO>> {
  // Enforce max devices per user
  const existingDevices = await devicesRepo.getDevicesByUser(userId);
  if (existingDevices.length >= Limits.MAX_DEVICES_PER_USER) {
    return failure(
      ErrorCode.DEVICE_REGISTRATION_FAILED,
      `Maximum of ${Limits.MAX_DEVICES_PER_USER} devices allowed.`,
      400,
    );
  }

  const device = await devicesRepo.upsertDevice({
    userId,
    platform: data.platform,
    deviceName: data.deviceName,
    pushToken: data.pushToken,
    voipToken: data.voipToken,
    appVersion: data.appVersion,
  });

  // Audit
  await auditQueue.add('device-registered', {
    actorUserId: userId,
    meetingId: null,
    eventType: AuditEvent.DEVICE_REGISTERED,
    payload: {
      deviceId: device.id,
      platform: device.platform,
    },
    ipAddress: meta?.ipAddress,
    userAgent: meta?.userAgent,
    timestamp: new Date().toISOString(),
  });

  log.info({ userId, deviceId: device.id, platform: device.platform }, 'Device registered');

  return success({
    id: device.id,
    platform: device.platform,
    deviceName: device.deviceName,
    appVersion: device.appVersion,
    createdAt: device.createdAt,
    updatedAt: device.updatedAt,
  });
}

// ---------------------------------------------------------------------------
// Get user devices
// ---------------------------------------------------------------------------

export async function getUserDevices(userId: string): Promise<ServiceResult<DeviceDTO[]>> {
  const devices = await devicesRepo.getDevicesByUser(userId);

  return success(
    devices.map((d) => ({
      id: d.id,
      platform: d.platform,
      deviceName: d.deviceName,
      appVersion: d.appVersion,
      createdAt: d.createdAt,
      updatedAt: d.updatedAt,
    })),
  );
}
