import { redis } from './client.js';
import { RedisKey, Limits } from '../../config/constants.js';
import { logger } from '../../logging/logger.js';

// ---------------------------------------------------------------------------
// User Socket Tracking
// ---------------------------------------------------------------------------

/**
 * Track a socket connection for a user.
 * Uses a Redis SET so one user can have multiple socket connections.
 */
export async function addUserSocket(userId: string, socketId: string): Promise<void> {
  const key = RedisKey.userSockets(userId);
  await redis.sadd(key, socketId);
  await redis.expire(key, Limits.PRESENCE_TTL_SECONDS);
  logger.debug({ userId, socketId }, 'Socket added to user presence');
}

/**
 * Remove a socket connection for a user.
 */
export async function removeUserSocket(userId: string, socketId: string): Promise<void> {
  const key = RedisKey.userSockets(userId);
  await redis.srem(key, socketId);
  const remaining = await redis.scard(key);
  if (remaining === 0) {
    await redis.del(key);
  }
  logger.debug({ userId, socketId, remaining }, 'Socket removed from user presence');
}

/**
 * Get all socket IDs for a user.
 */
export async function getUserSockets(userId: string): Promise<string[]> {
  return redis.smembers(RedisKey.userSockets(userId));
}

/**
 * Check if a user has any active sockets.
 */
export async function isUserOnline(userId: string): Promise<boolean> {
  const count = await redis.scard(RedisKey.userSockets(userId));
  return count > 0;
}

// ---------------------------------------------------------------------------
// Meeting Participant Presence
// ---------------------------------------------------------------------------

export interface MeetingPresenceData {
  userId: string;
  socketId: string;
  joinedAt: string;
  micEnabled: boolean;
  cameraEnabled: boolean;
  role: string;
  name: string;
}

/**
 * Add a participant to meeting presence.
 * Uses a Redis HASH keyed by meetingId, field = userId, value = JSON data.
 */
export async function setMeetingParticipant(
  meetingId: string,
  userId: string,
  data: MeetingPresenceData,
): Promise<void> {
  const key = RedisKey.meetingParticipants(meetingId);
  await redis.hset(key, userId, JSON.stringify(data));
  await redis.expire(key, Limits.PRESENCE_TTL_SECONDS);
  logger.debug({ meetingId, userId }, 'Participant added to meeting presence');
}

/**
 * Remove a participant from meeting presence.
 */
export async function removeMeetingParticipant(
  meetingId: string,
  userId: string,
): Promise<void> {
  const key = RedisKey.meetingParticipants(meetingId);
  await redis.hdel(key, userId);
  logger.debug({ meetingId, userId }, 'Participant removed from meeting presence');
}

/**
 * Get all participants in a meeting.
 */
export async function getMeetingParticipants(
  meetingId: string,
): Promise<MeetingPresenceData[]> {
  const key = RedisKey.meetingParticipants(meetingId);
  const raw: Record<string, string> = await redis.hgetall(key);
  return Object.values(raw).map((v: string) => JSON.parse(v) as MeetingPresenceData);
}

/**
 * Get a specific participant's presence data.
 */
export async function getMeetingParticipant(
  meetingId: string,
  userId: string,
): Promise<MeetingPresenceData | null> {
  const key = RedisKey.meetingParticipants(meetingId);
  const raw = await redis.hget(key, userId);
  return raw ? (JSON.parse(raw) as MeetingPresenceData) : null;
}

/**
 * Update a participant's media flags in presence.
 */
export async function updateParticipantMedia(
  meetingId: string,
  userId: string,
  updates: { micEnabled?: boolean; cameraEnabled?: boolean },
): Promise<MeetingPresenceData | null> {
  const existing = await getMeetingParticipant(meetingId, userId);
  if (!existing) return null;

  const updated: MeetingPresenceData = {
    ...existing,
    micEnabled: updates.micEnabled !== undefined ? updates.micEnabled : existing.micEnabled,
    cameraEnabled: updates.cameraEnabled !== undefined ? updates.cameraEnabled : existing.cameraEnabled,
  };

  await setMeetingParticipant(meetingId, userId, updated);
  return updated;
}

/**
 * Get count of active participants in a meeting.
 */
export async function getMeetingParticipantCount(meetingId: string): Promise<number> {
  const key = RedisKey.meetingParticipants(meetingId);
  return redis.hlen(key);
}

/**
 * Refresh the TTL on meeting presence (called periodically to prevent expiry).
 */
export async function refreshMeetingPresence(meetingId: string): Promise<void> {
  const key = RedisKey.meetingParticipants(meetingId);
  await redis.expire(key, Limits.PRESENCE_TTL_SECONDS);
}

/**
 * Clear all presence data for a meeting (used when meeting ends).
 */
export async function clearMeetingPresence(meetingId: string): Promise<void> {
  const key = RedisKey.meetingParticipants(meetingId);
  await redis.del(key);
  logger.info({ meetingId }, 'Meeting presence cleared');
}
