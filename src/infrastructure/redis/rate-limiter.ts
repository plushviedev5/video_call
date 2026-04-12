import { redis } from './client.js';
import { RedisKey } from '../../config/constants.js';

// ---------------------------------------------------------------------------
// Sliding Window Rate Limiter (Redis-backed)
// ---------------------------------------------------------------------------

export interface RateLimitResult {
  allowed: boolean;
  remaining: number;
  resetInSeconds: number;
  total: number;
}

/**
 * Check and consume a rate limit token using a sliding window algorithm.
 *
 * @param action  - Action identifier (e.g. "login", "chat", "join")
 * @param key     - Unique key for the actor (e.g. IP address or user ID)
 * @param maxRequests - Maximum requests allowed in the window
 * @param windowSeconds - Window duration in seconds
 */
export async function checkRateLimit(
  action: string,
  key: string,
  maxRequests: number,
  windowSeconds: number,
): Promise<RateLimitResult> {
  const redisKey = RedisKey.rateLimitBucket(action, key);
  const now = Date.now();
  const windowStart = now - windowSeconds * 1000;

  // Use a pipeline for atomicity
  const pipeline = redis.pipeline();

  // Remove entries outside the window
  pipeline.zremrangebyscore(redisKey, 0, windowStart);

  // Count current entries
  pipeline.zcard(redisKey);

  // Add the current request
  pipeline.zadd(redisKey, now, `${now}:${Math.random().toString(36).slice(2, 10)}`);

  // Set key expiry to window duration (cleanup)
  pipeline.expire(redisKey, windowSeconds);

  const results = await pipeline.exec();

  // results[1] is the zcard result: [error, count]
  const currentCount = (results?.[1]?.[1] as number) ?? 0;

  if (currentCount >= maxRequests) {
    // Over limit — remove the entry we just added
    // (the zadd already happened, so we need to pop it)
    const members = await redis.zrangebyscore(redisKey, now, now);
    if (members.length > 0) {
      await redis.zrem(redisKey, members[members.length - 1]!);
    }

    // Find the oldest entry to determine reset time
    const oldest = await redis.zrange(redisKey, 0, 0, 'WITHSCORES');
    const oldestTimestamp = oldest.length >= 2 ? parseInt(oldest[1]!, 10) : now;
    const resetInSeconds = Math.ceil(
      (oldestTimestamp + windowSeconds * 1000 - now) / 1000,
    );

    return {
      allowed: false,
      remaining: 0,
      resetInSeconds: Math.max(resetInSeconds, 1),
      total: maxRequests,
    };
  }

  return {
    allowed: true,
    remaining: maxRequests - currentCount - 1,
    resetInSeconds: windowSeconds,
    total: maxRequests,
  };
}

// ---------------------------------------------------------------------------
// Signaling deduplication
// ---------------------------------------------------------------------------

/**
 * Check if a signaling message has already been processed (dedup).
 * Returns true if this is the first time seeing this message ID.
 */
export async function checkSignalingDedup(
  meetingId: string,
  messageId: string,
  ttlSeconds: number = 30,
): Promise<boolean> {
  const key = RedisKey.signalingDedup(meetingId, messageId);
  const result = await redis.set(key, '1', 'EX', ttlSeconds, 'NX');
  return result === 'OK'; // true = first time (not duplicate)
}
