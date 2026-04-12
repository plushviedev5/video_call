import type { FastifyRequest, FastifyReply } from 'fastify';
import { checkRateLimit } from '../infrastructure/redis/rate-limiter.js';
import { rateLimitError } from '../errors/app-error.js';
import type { AuthPayload } from '../common/types.js';

// ---------------------------------------------------------------------------
// Rate limiting configuration per action
// ---------------------------------------------------------------------------

export interface RateLimitConfig {
  action: string;
  maxRequests: number;
  windowSeconds: number;
  keyExtractor: (request: FastifyRequest) => string;
}

// Predefined rate limit configurations
export const RateLimits: Record<string, RateLimitConfig> = {
  login: {
    action: 'login',
    maxRequests: 10,
    windowSeconds: 300, // 10 attempts per 5 minutes
    keyExtractor: (req) => req.ip,
  },
  refresh: {
    action: 'refresh',
    maxRequests: 20,
    windowSeconds: 300, // 20 refreshes per 5 minutes
    keyExtractor: (req) => req.ip,
  },
  meetingJoin: {
    action: 'meeting_join',
    maxRequests: 30,
    windowSeconds: 60, // 30 joins per minute
    keyExtractor: (req) =>
      (req as FastifyRequest & { user?: AuthPayload }).user?.userId ?? req.ip,
  },
  chatSend: {
    action: 'chat_send',
    maxRequests: 60,
    windowSeconds: 60, // 60 messages per minute
    keyExtractor: (req) =>
      (req as FastifyRequest & { user?: AuthPayload }).user?.userId ?? req.ip,
  },
  signaling: {
    action: 'signaling',
    maxRequests: 200,
    windowSeconds: 10, // 200 signaling messages per 10 seconds
    keyExtractor: (req) =>
      (req as FastifyRequest & { user?: AuthPayload }).user?.userId ?? req.ip,
  },
  deviceRegister: {
    action: 'device_register',
    maxRequests: 10,
    windowSeconds: 60, // 10 registrations per minute
    keyExtractor: (req) =>
      (req as FastifyRequest & { user?: AuthPayload }).user?.userId ?? req.ip,
  },
  general: {
    action: 'general',
    maxRequests: 100,
    windowSeconds: 60,
    keyExtractor: (req) => req.ip,
  },
};

// ---------------------------------------------------------------------------
// Rate limit middleware factory
// ---------------------------------------------------------------------------

/**
 * Creates a Fastify preHandler that enforces rate limiting.
 * @param rateLimitConfig - The rate limit configuration to apply
 */
export function createRateLimitMiddleware(rateLimitConfig: RateLimitConfig) {
  return async function rateLimitMiddleware(
    request: FastifyRequest,
    reply: FastifyReply,
  ): Promise<void> {
    const key = rateLimitConfig.keyExtractor(request);

    const result = await checkRateLimit(
      rateLimitConfig.action,
      key,
      rateLimitConfig.maxRequests,
      rateLimitConfig.windowSeconds,
    );

    // Always set rate limit headers
    reply.header('X-RateLimit-Limit', result.total);
    reply.header('X-RateLimit-Remaining', Math.max(0, result.remaining));
    reply.header('X-RateLimit-Reset', result.resetInSeconds);

    if (!result.allowed) {
      reply.header('Retry-After', result.resetInSeconds);
      throw rateLimitError(result.resetInSeconds);
    }
  };
}

// ---------------------------------------------------------------------------
// Socket rate limiting (non-middleware, callable directly)
// ---------------------------------------------------------------------------

export async function checkSocketRateLimit(
  action: string,
  userId: string,
  maxRequests: number = 200,
  windowSeconds: number = 10,
): Promise<boolean> {
  const result = await checkRateLimit(action, userId, maxRequests, windowSeconds);
  return result.allowed;
}
