import { getPrismaClient } from '../../infrastructure/db/prisma.js';
import type { Device } from '@prisma/client';

// ---------------------------------------------------------------------------
// Devices repository
// ---------------------------------------------------------------------------

/**
 * Upsert a device — create or update based on userId + platform + pushToken.
 */
export async function upsertDevice(data: {
  userId: string;
  platform: string;
  deviceName?: string;
  pushToken?: string;
  voipToken?: string;
  appVersion?: string;
}): Promise<Device> {
  // Check if device with same push token exists for this user
  if (data.pushToken) {
    const existing = await getPrismaClient().device.findFirst({
      where: {
        userId: data.userId,
        platform: data.platform as Device['platform'],
        pushToken: data.pushToken,
      },
    });

    if (existing) {
      return getPrismaClient().device.update({
        where: { id: existing.id },
        data: {
          deviceName: data.deviceName ?? existing.deviceName,
          voipToken: data.voipToken ?? existing.voipToken,
          appVersion: data.appVersion ?? existing.appVersion,
        },
      });
    }
  }

  return getPrismaClient().device.create({
    data: {
      userId: data.userId,
      platform: data.platform as Device['platform'],
      deviceName: data.deviceName,
      pushToken: data.pushToken,
      voipToken: data.voipToken,
      appVersion: data.appVersion,
    },
  });
}

/**
 * Get all devices for a user.
 */
export async function getDevicesByUser(userId: string): Promise<Device[]> {
  return getPrismaClient().device.findMany({
    where: { userId },
    orderBy: { updatedAt: 'desc' },
  });
}

/**
 * Get a specific device by ID.
 */
export async function getDeviceById(id: string): Promise<Device | null> {
  return getPrismaClient().device.findUnique({ where: { id } });
}

/**
 * Remove a device.
 */
export async function deleteDevice(id: string, userId: string): Promise<boolean> {
  const result = await getPrismaClient().device.deleteMany({
    where: { id, userId },
  });
  return result.count > 0;
}
