import type { FastifyInstance, FastifyRequest, FastifyReply } from 'fastify';
import { loginSchema, refreshTokenSchema, registerSchema } from '../../validation/schemas.js';
import * as authService from './auth.service.js';
import { authMiddleware } from '../../middleware/auth.middleware.js';
import { createRateLimitMiddleware, RateLimits } from '../../middleware/rate-limit.middleware.js';
import type { AuthPayload } from '../../common/types.js';
import { AppError } from '../../errors/app-error.js';
import type { ErrorCodeType } from '../../config/constants.js';

// ---------------------------------------------------------------------------
// Helper: throw AppError from ServiceResult
// ---------------------------------------------------------------------------

function throwServiceError(error: { code: string; message: string; statusCode: number }): never {
  throw new AppError(error.code as ErrorCodeType, error.message, error.statusCode);
}

// ---------------------------------------------------------------------------
// Auth controller — registers routes on the Fastify instance
// ---------------------------------------------------------------------------

export async function authController(app: FastifyInstance): Promise<void> {
  // -----------------------------------------------------------------------
  // POST /v1/auth/register
  // -----------------------------------------------------------------------
  app.post(
    '/register',
    { preHandler: [createRateLimitMiddleware(RateLimits.login!)] },
    async (request: FastifyRequest, reply: FastifyReply) => {
      const input = registerSchema.parse(request.body);

      const result = await authService.register(input.name, input.email, input.password, {
        ipAddress: request.ip,
        userAgent: request.headers['user-agent'],
      });

      if (!result.success) throwServiceError(result.error);

      reply.status(201).send({ data: result.data });
    },
  );

  // -----------------------------------------------------------------------
  // POST /v1/auth/login
  // -----------------------------------------------------------------------
  app.post(
    '/login',
    { preHandler: [createRateLimitMiddleware(RateLimits.login!)] },
    async (request: FastifyRequest, reply: FastifyReply) => {
      const input = loginSchema.parse(request.body);

      const result = await authService.login(input.email, input.password, {
        ipAddress: request.ip,
        userAgent: request.headers['user-agent'],
        deviceId: input.deviceId,
      });

      if (!result.success) throwServiceError(result.error);

      reply.status(200).send({ data: result.data });
    },
  );

  // -----------------------------------------------------------------------
  // POST /v1/auth/refresh
  // -----------------------------------------------------------------------
  app.post(
    '/refresh',
    { preHandler: [createRateLimitMiddleware(RateLimits.refresh!)] },
    async (request: FastifyRequest, reply: FastifyReply) => {
      const input = refreshTokenSchema.parse(request.body);

      const result = await authService.refreshAccessToken(input.refreshToken, {
        ipAddress: request.ip,
        userAgent: request.headers['user-agent'],
      });

      if (!result.success) throwServiceError(result.error);

      reply.status(200).send({ data: result.data });
    },
  );

  // -----------------------------------------------------------------------
  // POST /v1/auth/logout
  // -----------------------------------------------------------------------
  app.post(
    '/logout',
    { preHandler: [authMiddleware] },
    async (request: FastifyRequest, reply: FastifyReply) => {
      const user = (request as FastifyRequest & { user: AuthPayload }).user;
      const { allDevices } = (request.body as { allDevices?: boolean }) ?? {};

      const result = await authService.logout(
        user.sessionId,
        user.userId,
        allDevices ?? false,
        {
          ipAddress: request.ip,
          userAgent: request.headers['user-agent'],
        },
      );

      if (!result.success) throwServiceError(result.error);

      reply.status(200).send({ data: result.data });
    },
  );
}
