import type { FastifyInstance, FastifyRequest, FastifyReply } from 'fastify';
import { authMiddleware } from '../../middleware/auth.middleware.js';
import { createRateLimitMiddleware, RateLimits } from '../../middleware/rate-limit.middleware.js';
import { registerDeviceSchema } from '../../validation/schemas.js';
import * as devicesService from './devices.service.js';
import type { AuthPayload } from '../../common/types.js';
import { AppError } from '../../errors/app-error.js';
import type { ErrorCodeType } from '../../config/constants.js';

function throwServiceError(error: { code: string; message: string; statusCode: number }): never {
  throw new AppError(error.code as ErrorCodeType, error.message, error.statusCode);
}

// ---------------------------------------------------------------------------
// Devices controller
// ---------------------------------------------------------------------------

export async function devicesController(app: FastifyInstance): Promise<void> {
  app.addHook('preHandler', authMiddleware);

  // POST /v1/devices/register — Register or update a device
  app.post(
    '/register',
    { preHandler: [createRateLimitMiddleware(RateLimits.deviceRegister!)] },
    async (request: FastifyRequest, reply: FastifyReply) => {
      const user = (request as FastifyRequest & { user: AuthPayload }).user;
      const input = registerDeviceSchema.parse(request.body);

      const result = await devicesService.registerDevice(user.userId, input, {
        ipAddress: request.ip,
        userAgent: request.headers['user-agent'],
      });

      if (!result.success) throwServiceError(result.error);
      reply.status(201).send({ data: result.data });
    },
  );

  // GET /v1/devices — List user's devices
  app.get('/', async (request: FastifyRequest, reply: FastifyReply) => {
    const user = (request as FastifyRequest & { user: AuthPayload }).user;

    const result = await devicesService.getUserDevices(user.userId);
    if (!result.success) throwServiceError(result.error);

    reply.status(200).send({ data: result.data });
  });
}
