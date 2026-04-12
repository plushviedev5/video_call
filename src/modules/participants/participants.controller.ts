import type { FastifyInstance, FastifyRequest, FastifyReply } from 'fastify';
import { authMiddleware } from '../../middleware/auth.middleware.js';
import * as participantsService from './participants.service.js';
import { updateMediaSchema } from '../../validation/schemas.js';
import type { AuthPayload } from '../../common/types.js';
import { AppError } from '../../errors/app-error.js';
import type { ErrorCodeType } from '../../config/constants.js';

function throwServiceError(error: { code: string; message: string; statusCode: number }): never {
  throw new AppError(error.code as ErrorCodeType, error.message, error.statusCode);
}

// ---------------------------------------------------------------------------
// Participants controller
// ---------------------------------------------------------------------------

export async function participantsController(app: FastifyInstance): Promise<void> {
  app.addHook('preHandler', authMiddleware);

  // PATCH /v1/participants/:meetingId/media — Update mic/camera flags
  app.patch('/:meetingId/media', async (request: FastifyRequest, reply: FastifyReply) => {
    const user = (request as FastifyRequest & { user: AuthPayload }).user;
    const { meetingId } = request.params as { meetingId: string };
    const input = updateMediaSchema.parse(request.body);

    const result = await participantsService.updateMedia(meetingId, user.userId, input, {
      ipAddress: request.ip,
      userAgent: request.headers['user-agent'],
    });

    if (!result.success) throwServiceError(result.error);
    reply.status(200).send({ data: result.data });
  });
}
