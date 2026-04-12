import type { FastifyRequest, FastifyReply } from 'fastify';
import jwt from 'jsonwebtoken';
import { config } from '../config/index.js';
import { ErrorCode } from '../config/constants.js';
import { AppError } from '../errors/app-error.js';
import type { AuthPayload } from '../common/types.js';
import { logger } from '../logging/logger.js';

// ---------------------------------------------------------------------------
// JWT verification
// ---------------------------------------------------------------------------

function verifyAccessToken(token: string): AuthPayload {
  try {
    const decoded = jwt.verify(token, config.jwt.accessSecret) as AuthPayload & {
      iat: number;
      exp: number;
    };
    return {
      userId: decoded.userId,
      email: decoded.email,
      sessionId: decoded.sessionId,
    };
  } catch (error) {
    if (error instanceof jwt.TokenExpiredError) {
      throw new AppError(ErrorCode.TOKEN_EXPIRED, 'Access token has expired.', 401);
    }
    if (error instanceof jwt.JsonWebTokenError) {
      throw new AppError(ErrorCode.TOKEN_INVALID, 'Access token is invalid.', 401);
    }
    throw new AppError(ErrorCode.UNAUTHORIZED, 'Authentication failed.', 401);
  }
}

// ---------------------------------------------------------------------------
// Fastify preHandler (REST)
// ---------------------------------------------------------------------------

export async function authMiddleware(
  request: FastifyRequest,
  _reply: FastifyReply,
): Promise<void> {
  const authHeader = request.headers.authorization;

  if (!authHeader || !authHeader.startsWith('Bearer ')) {
    throw new AppError(
      ErrorCode.UNAUTHORIZED,
      'Missing or malformed Authorization header.',
      401,
    );
  }

  const token = authHeader.slice(7);

  if (!token) {
    throw new AppError(ErrorCode.UNAUTHORIZED, 'Access token is required.', 401);
  }

  const payload = verifyAccessToken(token);

  // Attach user context to request (Fastify uses decorators)
  (request as FastifyRequest & { user: AuthPayload }).user = payload;
}

// ---------------------------------------------------------------------------
// Socket.IO authentication middleware
// ---------------------------------------------------------------------------

export function authenticateSocket(
  handshake: { auth?: { token?: string }; headers?: Record<string, string> },
): AuthPayload {
  // Try auth object first (Socket.IO recommended), then Authorization header
  const token =
    handshake.auth?.token ??
    handshake.headers?.authorization?.replace('Bearer ', '');

  if (!token) {
    throw new AppError(
      ErrorCode.SOCKET_AUTH_FAILED,
      'Socket authentication requires an access token.',
      401,
    );
  }

  try {
    return verifyAccessToken(token);
  } catch (error) {
    logger.warn({ error }, 'Socket authentication failed');
    throw new AppError(
      ErrorCode.SOCKET_AUTH_FAILED,
      'Socket authentication failed. Token is invalid or expired.',
      401,
    );
  }
}

// ---------------------------------------------------------------------------
// Role-based access control helper
// ---------------------------------------------------------------------------

export function requireRole(
  userRole: string,
  requiredRoles: string[],
  errorMessage: string = 'Insufficient permissions for this action.',
): void {
  if (!requiredRoles.includes(userRole)) {
    throw new AppError(ErrorCode.INSUFFICIENT_ROLE, errorMessage, 403);
  }
}
