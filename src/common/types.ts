import type { FastifyRequest } from 'fastify';

// ---------------------------------------------------------------------------
// Authenticated request context
// ---------------------------------------------------------------------------

export interface AuthPayload {
  userId: string;
  email: string;
  sessionId: string;
}

/**
 * Extended Fastify request with authenticated user context.
 * Populated by the auth middleware.
 */
export interface AuthenticatedRequest extends FastifyRequest {
  user: AuthPayload;
}

// ---------------------------------------------------------------------------
// Pagination
// ---------------------------------------------------------------------------

export interface PaginationParams {
  page: number;
  limit: number;
}

export interface PaginatedResult<T> {
  data: T[];
  pagination: {
    page: number;
    limit: number;
    total: number;
    totalPages: number;
    hasNext: boolean;
    hasPrevious: boolean;
  };
}

export function buildPaginatedResult<T>(
  data: T[],
  total: number,
  params: PaginationParams,
): PaginatedResult<T> {
  const totalPages = Math.ceil(total / params.limit);
  return {
    data,
    pagination: {
      page: params.page,
      limit: params.limit,
      total,
      totalPages,
      hasNext: params.page < totalPages,
      hasPrevious: params.page > 1,
    },
  };
}

// ---------------------------------------------------------------------------
// Generic service result
// ---------------------------------------------------------------------------

export type ServiceResult<T> =
  | { success: true; data: T }
  | { success: false; error: { code: string; message: string; statusCode: number; details?: Record<string, unknown> } };

export function success<T>(data: T): ServiceResult<T> {
  return { success: true, data };
}

export function failure<T>(
  code: string,
  message: string,
  statusCode: number = 400,
  details?: Record<string, unknown>,
): ServiceResult<T> {
  return { success: false, error: { code, message, statusCode, details } };
}

// ---------------------------------------------------------------------------
// API response envelope
// ---------------------------------------------------------------------------

export interface ApiResponse<T> {
  data: T;
  meta?: Record<string, unknown>;
}

export interface ApiErrorResponse {
  error: {
    code: string;
    message: string;
    details?: Record<string, unknown>;
  };
}

// ---------------------------------------------------------------------------
// Socket event payloads
// ---------------------------------------------------------------------------

export interface SocketAck<T = unknown> {
  success: boolean;
  data?: T;
  error?: {
    code: string;
    message: string;
  };
}

export interface WebRTCOfferPayload {
  meetingId: string;
  targetUserId: string;
  sdp: string;
  messageId: string;
}

export interface WebRTCAnswerPayload {
  meetingId: string;
  targetUserId: string;
  sdp: string;
  messageId: string;
}

export interface WebRTCIceCandidatePayload {
  meetingId: string;
  targetUserId: string;
  candidate: string;
  sdpMid: string | null;
  sdpMLineIndex: number | null;
  messageId: string;
}

export interface ChatSendPayload {
  meetingId: string;
  body: string;
}

export interface MediaUpdatePayload {
  meetingId: string;
  micEnabled?: boolean;
  cameraEnabled?: boolean;
}
