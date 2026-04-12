import type { FastifyError, FastifyReply, FastifyRequest } from 'fastify';
import { AppError } from './app-error.js';
import { ErrorCode } from '../config/constants.js';
import { logger } from '../logging/logger.js';
import { ZodError } from 'zod';

// ---------------------------------------------------------------------------
// Global Fastify error handler
// ---------------------------------------------------------------------------

export function globalErrorHandler(
  error: FastifyError | Error,
  request: FastifyRequest,
  reply: FastifyReply,
): void {
  const requestId = (request.headers['x-request-id'] as string) ?? request.id;

  // ----- AppError (operational) -----
  if (error instanceof AppError) {
    if (error.statusCode >= 500) {
      logger.error(
        {
          requestId,
          code: error.code,
          message: error.message,
          stack: error.stack,
          url: request.url,
          method: request.method,
        },
        'Server error',
      );
    } else {
      logger.warn(
        { requestId, code: error.code, message: error.message, url: request.url },
        'Client error',
      );
    }

    reply.status(error.statusCode).send(error.toJSON());
    return;
  }

  // ----- Zod validation error -----
  if (error instanceof ZodError) {
    const details: Record<string, unknown> = {
      issues: error.issues.map((i) => ({
        path: i.path.join('.'),
        message: i.message,
        code: i.code,
      })),
    };

    logger.warn(
      { requestId, validationErrors: details, url: request.url },
      'Validation error',
    );

    reply.status(400).send({
      error: {
        code: ErrorCode.VALIDATION_ERROR,
        message: 'Request validation failed.',
        details,
      },
    });
    return;
  }

  // ----- Fastify validation error (schema) -----
  const fastifyError = error as FastifyError;
  if (fastifyError.validation) {
    logger.warn(
      { requestId, validation: fastifyError.validation, url: request.url },
      'Schema validation error',
    );

    reply.status(400).send({
      error: {
        code: ErrorCode.VALIDATION_ERROR,
        message: error.message || 'Request validation failed.',
        details: { validation: fastifyError.validation },
      },
    });
    return;
  }

  // ----- Rate limit error (from @fastify/rate-limit) -----
  if (fastifyError.statusCode === 429) {
    reply.status(429).send({
      error: {
        code: ErrorCode.RATE_LIMIT_EXCEEDED,
        message: 'Too many requests. Please try again later.',
        details: {},
      },
    });
    return;
  }

  // ----- Unexpected error -----
  logger.error(
    {
      requestId,
      error: error.message,
      stack: error.stack,
      name: error.name,
      url: request.url,
      method: request.method,
    },
    'Unhandled error',
  );

  reply.status(500).send({
    error: {
      code: ErrorCode.INTERNAL_ERROR,
      message: 'An unexpected error occurred.',
      details: {},
    },
  });
}

// ---------------------------------------------------------------------------
// 404 handler
// ---------------------------------------------------------------------------

export function notFoundHandler(
  request: FastifyRequest,
  reply: FastifyReply,
): void {
  reply.status(404).send({
    error: {
      code: ErrorCode.NOT_FOUND,
      message: `Route ${request.method} ${request.url} not found.`,
      details: {},
    },
  });
}
