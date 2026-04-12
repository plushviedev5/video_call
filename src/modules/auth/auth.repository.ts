import { getPrismaClient } from '../../infrastructure/db/prisma.js';
import type { User, Session } from '@prisma/client';
import { logger } from '../../logging/logger.js';

const log = logger.child({ module: 'auth.repository' });

// ---------------------------------------------------------------------------
// User queries
// ---------------------------------------------------------------------------

export async function findUserByEmail(email: string): Promise<User | null> {
  return getPrismaClient().user.findUnique({
    where: { email },
  });
}

export async function findUserById(id: string): Promise<User | null> {
  return getPrismaClient().user.findUnique({
    where: { id },
  });
}

export async function createUser(data: {
  name: string;
  email: string;
  password: string;
}): Promise<User> {
  const user = await getPrismaClient().user.create({ data });
  log.info({ userId: user.id }, 'User created');
  return user;
}

// ---------------------------------------------------------------------------
// Session queries
// ---------------------------------------------------------------------------

export async function createSession(data: {
  userId: string;
  refreshTokenHash: string;
  deviceId?: string;
  userAgent?: string;
  ipAddress?: string;
  expiresAt: Date;
}): Promise<Session> {
  return getPrismaClient().session.create({ data });
}

export async function findSessionById(id: string): Promise<Session | null> {
  return getPrismaClient().session.findUnique({
    where: { id },
  });
}

export async function findSessionByTokenHash(
  refreshTokenHash: string,
): Promise<Session | null> {
  return getPrismaClient().session.findFirst({
    where: { refreshTokenHash },
  });
}

export async function deleteSession(id: string): Promise<void> {
  await getPrismaClient().session.delete({
    where: { id },
  });
  log.debug({ sessionId: id }, 'Session deleted');
}

export async function deleteAllUserSessions(userId: string): Promise<number> {
  const result = await getPrismaClient().session.deleteMany({
    where: { userId },
  });
  log.info({ userId, count: result.count }, 'All user sessions deleted');
  return result.count;
}

export async function deleteExpiredSessions(): Promise<number> {
  const result = await getPrismaClient().session.deleteMany({
    where: {
      expiresAt: { lt: new Date() },
    },
  });
  if (result.count > 0) {
    log.info({ count: result.count }, 'Expired sessions cleaned up');
  }
  return result.count;
}

export async function countUserSessions(userId: string): Promise<number> {
  return getPrismaClient().session.count({
    where: { userId },
  });
}

export async function getOldestUserSession(userId: string): Promise<Session | null> {
  return getPrismaClient().session.findFirst({
    where: { userId },
    orderBy: { createdAt: 'asc' },
  });
}

/**
 * Update the refresh token hash for a session (token rotation).
 */
export async function rotateSessionToken(
  sessionId: string,
  newRefreshTokenHash: string,
  newExpiresAt: Date,
): Promise<Session> {
  return getPrismaClient().session.update({
    where: { id: sessionId },
    data: {
      refreshTokenHash: newRefreshTokenHash,
      expiresAt: newExpiresAt,
    },
  });
}
