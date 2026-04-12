import type { FastifyInstance, FastifyRequest, FastifyReply } from 'fastify';
import { authMiddleware } from '../../middleware/auth.middleware.js';
import { createRateLimitMiddleware, RateLimits } from '../../middleware/rate-limit.middleware.js';
import { sendChatMessageSchema, chatQuerySchema } from '../../validation/schemas.js';
import * as chatService from './chat.service.js';
import type { AuthPayload } from '../../common/types.js';
import { AppError } from '../../errors/app-error.js';
import type { ErrorCodeType } from '../../config/constants.js';

function throwServiceError(error: { code: string; message: string; statusCode: number }): never {
  throw new AppError(error.code as ErrorCodeType, error.message, error.statusCode);
}

// ---------------------------------------------------------------------------
// Chat controller
// ---------------------------------------------------------------------------

export async function chatController(app: FastifyInstance): Promise<void> {
  app.addHook('preHandler', authMiddleware);

  // GET /v1/meetings/:id/chat — Get chat history
  app.get('/:id/chat', async (request: FastifyRequest, reply: FastifyReply) => {
    const user = (request as FastifyRequest & { user: AuthPayload }).user;
    const { id } = request.params as { id: string };
    const query = chatQuerySchema.parse(request.query);

    const result = await chatService.getChatHistory(id, user.userId, query.page, query.limit, query.before);
    if (!result.success) throwServiceError(result.error);

    reply.status(200).send(result.data);
  });

  // POST /v1/meetings/:id/chat — Send a chat message (REST fallback)
  app.post(
    '/:id/chat',
    { preHandler: [createRateLimitMiddleware(RateLimits.chatSend!)] },
    async (request: FastifyRequest, reply: FastifyReply) => {
      const user = (request as FastifyRequest & { user: AuthPayload }).user;
      const { id } = request.params as { id: string };
      const input = sendChatMessageSchema.parse(request.body);

      const result = await chatService.sendMessage(id, user.userId, input.body, {
        ipAddress: request.ip,
        userAgent: request.headers['user-agent'],
      });

      if (!result.success) throwServiceError(result.error);
      reply.status(201).send({ data: result.data });
    },
  );
}
