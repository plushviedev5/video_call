import type { FastifyRequest, FastifyReply } from 'fastify';
import { v4 as uuidv4 } from 'uuid';
import { logger } from '../logging/logger.js';

// ---------------------------------------------------------------------------
// Request context middleware
// ---------------------------------------------------------------------------
// Generates a unique request_id and attaches contextual information
// to every request for distributed tracing and log correlation.
// ---------------------------------------------------------------------------

export async function requestContextMiddleware(
  request: FastifyRequest,
  _reply: FastifyReply,
): Promise<void> {
  // Use existing X-Request-Id header or generate a new one
  const requestId =
    (request.headers['x-request-id'] as string) || uuidv4();

  // Attach to request for downstream use
  request.id = requestId;

  // Create a child logger with request context
  request.log = logger.child({
    requestId,
    method: request.method,
    url: request.url,
    ip: request.ip,
    userAgent: request.headers['user-agent']?.slice(0, 200),
  });
}

// ---------------------------------------------------------------------------
// Response header middleware (onSend hook)
// ---------------------------------------------------------------------------

export async function responseHeadersMiddleware(
  request: FastifyRequest,
  reply: FastifyReply,
): Promise<void> {
  // Echo request_id back to client for correlation
  reply.header('X-Request-Id', request.id);
}
