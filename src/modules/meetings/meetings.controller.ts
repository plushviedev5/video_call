import type { FastifyInstance, FastifyRequest, FastifyReply } from 'fastify';
import { authMiddleware } from '../../middleware/auth.middleware.js';
import { createRateLimitMiddleware, RateLimits } from '../../middleware/rate-limit.middleware.js';
import { createMeetingSchema, paginationSchema } from '../../validation/schemas.js';
import * as meetingsService from './meetings.service.js';
import * as participantsService from '../participants/participants.service.js';
import type { AuthPayload } from '../../common/types.js';
import { AppError } from '../../errors/app-error.js';
import type { ErrorCodeType } from '../../config/constants.js';

function throwServiceError(error: { code: string; message: string; statusCode: number }): never {
  throw new AppError(error.code as ErrorCodeType, error.message, error.statusCode);
}

// ---------------------------------------------------------------------------
// Meetings controller
// ---------------------------------------------------------------------------

export async function meetingsController(app: FastifyInstance): Promise<void> {
  app.addHook('preHandler', authMiddleware);

  // POST /v1/meetings — Create a new meeting
  app.post('/', async (request: FastifyRequest, reply: FastifyReply) => {
    const user = (request as FastifyRequest & { user: AuthPayload }).user;
    const input = createMeetingSchema.parse(request.body);

    const result = await meetingsService.createMeeting(user.userId, input.title, {
      ipAddress: request.ip,
      userAgent: request.headers['user-agent'],
    });

    if (!result.success) throwServiceError(result.error);
    reply.status(201).send({ data: result.data });
  });

  // GET /v1/meetings/history — Meeting history for authenticated user
  app.get('/history', async (request: FastifyRequest, reply: FastifyReply) => {
    const user = (request as FastifyRequest & { user: AuthPayload }).user;
    const { page, limit } = paginationSchema.parse(request.query);

    const result = await meetingsService.getMeetingHistory(user.userId, page, limit);
    if (!result.success) throwServiceError(result.error);

    reply.status(200).send(result.data);
  });

  // GET /v1/meetings/:id — Get meeting details
  app.get('/:id', async (request: FastifyRequest, reply: FastifyReply) => {
    const { id } = request.params as { id: string };

    const result = await meetingsService.getMeeting(id);
    if (!result.success) throwServiceError(result.error);

    reply.status(200).send({ data: result.data });
  });

  // POST /v1/meetings/:id/join — Join a meeting
  app.post(
    '/:id/join',
    { preHandler: [createRateLimitMiddleware(RateLimits.meetingJoin!)] },
    async (request: FastifyRequest, reply: FastifyReply) => {
      const user = (request as FastifyRequest & { user: AuthPayload }).user;
      const { id } = request.params as { id: string };

      const result = await meetingsService.joinMeeting(id, user.userId, {
        ipAddress: request.ip,
        userAgent: request.headers['user-agent'],
      });

      if (!result.success) throwServiceError(result.error);
      reply.status(200).send({ data: result.data });
    },
  );

  // POST /v1/meetings/:id/leave — Leave a meeting
  app.post('/:id/leave', async (request: FastifyRequest, reply: FastifyReply) => {
    const user = (request as FastifyRequest & { user: AuthPayload }).user;
    const { id } = request.params as { id: string };

    const result = await meetingsService.leaveMeeting(id, user.userId, {
      ipAddress: request.ip,
      userAgent: request.headers['user-agent'],
    });

    if (!result.success) throwServiceError(result.error);
    reply.status(200).send({ data: result.data });
  });

  // GET /v1/meetings/:id/participants — List active participants
  app.get('/:id/participants', async (request: FastifyRequest, reply: FastifyReply) => {
    const { id } = request.params as { id: string };

    const result = await participantsService.getActiveParticipants(id);
    if (!result.success) throwServiceError(result.error);

    reply.status(200).send({ data: result.data });
  });
}
