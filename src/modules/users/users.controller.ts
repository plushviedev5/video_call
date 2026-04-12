import type { FastifyInstance, FastifyRequest, FastifyReply } from 'fastify';
import { authMiddleware } from '../../middleware/auth.middleware.js';
import * as usersService from './users.service.js';
import type { AuthPayload } from '../../common/types.js';
import { AppError } from '../../errors/app-error.js';
import type { ErrorCodeType } from '../../config/constants.js';

function throwServiceError(error: { code: string; message: string; statusCode: number }): never {
  throw new AppError(error.code as ErrorCodeType, error.message, error.statusCode);
}

// ---------------------------------------------------------------------------
// Users controller
// ---------------------------------------------------------------------------

export async function usersController(app: FastifyInstance): Promise<void> {
  app.addHook('preHandler', authMiddleware);

  // -----------------------------------------------------------------------
  // GET /v1/users/me
  // -----------------------------------------------------------------------
  app.get('/me', async (request: FastifyRequest, reply: FastifyReply) => {
    const user = (request as FastifyRequest & { user: AuthPayload }).user;

    const result = await usersService.getMyProfile(user.userId);
    if (!result.success) throwServiceError(result.error);

    reply.status(200).send({ data: result.data });
  });
}
