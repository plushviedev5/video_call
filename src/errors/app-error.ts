import { ErrorCode, type ErrorCodeType } from '../config/constants.js';

// ---------------------------------------------------------------------------
// Application Error — structured, typed, serializable
// ---------------------------------------------------------------------------

export class AppError extends Error {
  public readonly code: ErrorCodeType;
  public readonly statusCode: number;
  public readonly details: Record<string, unknown>;
  public readonly isOperational: boolean;

  constructor(
    code: ErrorCodeType,
    message: string,
    statusCode: number = 400,
    details: Record<string, unknown> = {},
    isOperational: boolean = true,
  ) {
    super(message);
    this.name = 'AppError';
    this.code = code;
    this.statusCode = statusCode;
    this.details = details;
    this.isOperational = isOperational;

    // Maintain proper stack trace
    Error.captureStackTrace(this, this.constructor);
  }

  /**
   * Serialize to client-safe error response.
   * Internal details are NEVER leaked.
   */
  toJSON(): { error: { code: string; message: string; details: Record<string, unknown> } } {
    return {
      error: {
        code: this.code,
        message: this.message,
        details: this.details,
      },
    };
  }
}

// ---------------------------------------------------------------------------
// Factory helpers — one-liner creation for common errors
// ---------------------------------------------------------------------------

export function notFoundError(resource: string, id?: string): AppError {
  return new AppError(
    ErrorCode.NOT_FOUND,
    `${resource} not found${id ? `: ${id}` : ''}.`,
    404,
  );
}

export function unauthorizedError(message: string = 'Authentication required.'): AppError {
  return new AppError(ErrorCode.UNAUTHORIZED, message, 401);
}

export function forbiddenError(message: string = 'Insufficient permissions.'): AppError {
  return new AppError(ErrorCode.FORBIDDEN, message, 403);
}

export function validationError(
  message: string,
  details: Record<string, unknown> = {},
): AppError {
  return new AppError(ErrorCode.VALIDATION_ERROR, message, 400, details);
}

export function conflictError(message: string): AppError {
  return new AppError(ErrorCode.CONFLICT, message, 409);
}

export function rateLimitError(retryAfterSeconds: number): AppError {
  return new AppError(
    ErrorCode.RATE_LIMIT_EXCEEDED,
    'Too many requests. Please try again later.',
    429,
    { retryAfterSeconds },
  );
}

export function internalError(message: string = 'An unexpected error occurred.'): AppError {
  return new AppError(ErrorCode.INTERNAL_ERROR, message, 500, {}, false);
}

// ---------------------------------------------------------------------------
// Domain-specific errors
// ---------------------------------------------------------------------------

export function meetingNotFoundError(meetingIdOrCode: string): AppError {
  return new AppError(
    ErrorCode.MEETING_NOT_FOUND,
    'The meeting does not exist or is no longer available.',
    404,
    { meetingId: meetingIdOrCode },
  );
}

export function meetingAlreadyEndedError(meetingId: string): AppError {
  return new AppError(
    ErrorCode.MEETING_ALREADY_ENDED,
    'This meeting has already ended.',
    400,
    { meetingId },
  );
}

export function alreadyJoinedError(meetingId: string): AppError {
  return new AppError(
    ErrorCode.ALREADY_JOINED,
    'You have already joined this meeting.',
    409,
    { meetingId },
  );
}

export function notParticipantError(meetingId: string): AppError {
  return new AppError(
    ErrorCode.NOT_A_PARTICIPANT,
    'You are not a participant in this meeting.',
    403,
    { meetingId },
  );
}

export function invalidCredentialsError(): AppError {
  return new AppError(
    ErrorCode.INVALID_CREDENTIALS,
    'Invalid email or password.',
    401,
  );
}

export function tokenExpiredError(): AppError {
  return new AppError(
    ErrorCode.TOKEN_EXPIRED,
    'Your session has expired. Please log in again.',
    401,
  );
}

export function refreshTokenInvalidError(): AppError {
  return new AppError(
    ErrorCode.REFRESH_TOKEN_INVALID,
    'Refresh token is invalid or has been revoked.',
    401,
  );
}
