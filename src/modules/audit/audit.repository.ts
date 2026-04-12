import { getPrismaClient } from '../../infrastructure/db/prisma.js';
import type { AuditLog, Prisma } from '@prisma/client';

// ---------------------------------------------------------------------------
// Audit repository
// ---------------------------------------------------------------------------

export async function createAuditLog(data: {
  actorUserId: string | null;
  meetingId: string | null;
  eventType: string;
  payload?: Record<string, unknown>;
  ipAddress?: string;
  userAgent?: string;
}): Promise<AuditLog> {
  return getPrismaClient().auditLog.create({
    data: {
      actorUserId: data.actorUserId,
      meetingId: data.meetingId,
      eventType: data.eventType,
      payload: (data.payload ?? {}) as Prisma.InputJsonValue,
      ipAddress: data.ipAddress ?? null,
      userAgent: data.userAgent ?? null,
    },
  });
}

export async function getAuditLogsByMeeting(
  meetingId: string,
  page: number,
  limit: number,
): Promise<{ logs: AuditLog[]; total: number }> {
  const [logs, total] = await Promise.all([
    getPrismaClient().auditLog.findMany({
      where: { meetingId },
      orderBy: { createdAt: 'desc' },
      skip: (page - 1) * limit,
      take: limit,
    }),
    getPrismaClient().auditLog.count({ where: { meetingId } }),
  ]);

  return { logs, total };
}

export async function getAuditLogsByUser(
  userId: string,
  page: number,
  limit: number,
): Promise<{ logs: AuditLog[]; total: number }> {
  const [logs, total] = await Promise.all([
    getPrismaClient().auditLog.findMany({
      where: { actorUserId: userId },
      orderBy: { createdAt: 'desc' },
      skip: (page - 1) * limit,
      take: limit,
    }),
    getPrismaClient().auditLog.count({ where: { actorUserId: userId } }),
  ]);

  return { logs, total };
}
