import { z } from 'zod';

// ---------------------------------------------------------------------------
// Reusable schema fragments
// ---------------------------------------------------------------------------

export const uuidSchema = z.string().uuid('Must be a valid UUID.');

export const emailSchema = z
  .string()
  .email('Must be a valid email address.')
  .max(320)
  .transform((v) => v.toLowerCase().trim());

export const passwordSchema = z
  .string()
  .min(8, 'Password must be at least 8 characters.')
  .max(128, 'Password must be at most 128 characters.');

export const paginationSchema = z.object({
  page: z.coerce.number().int().positive().default(1),
  limit: z.coerce.number().int().positive().max(100).default(20),
});

export const meetingCodeSchema = z
  .string()
  .min(4, 'Meeting code must be at least 4 characters.')
  .max(20, 'Meeting code must be at most 20 characters.')
  .regex(/^[a-zA-Z0-9-]+$/, 'Meeting code must contain only letters, numbers, and hyphens.');

// ---------------------------------------------------------------------------
// Auth schemas
// ---------------------------------------------------------------------------

export const loginSchema = z.object({
  email: emailSchema,
  password: z.string().min(1, 'Password is required.'),
  deviceId: z.string().uuid().optional(),
});

export const registerSchema = z.object({
  name: z
    .string()
    .min(1, 'Name is required.')
    .max(255, 'Name must be at most 255 characters.')
    .trim(),
  email: emailSchema,
  password: passwordSchema,
});

export const refreshTokenSchema = z.object({
  refreshToken: z.string().min(1, 'Refresh token is required.'),
});

// ---------------------------------------------------------------------------
// Meeting schemas
// ---------------------------------------------------------------------------

export const createMeetingSchema = z.object({
  title: z
    .string()
    .max(500, 'Title must be at most 500 characters.')
    .optional(),
});

export const joinMeetingSchema = z.object({
  code: meetingCodeSchema.optional(),
});

// ---------------------------------------------------------------------------
// Chat schemas
// ---------------------------------------------------------------------------

export const sendChatMessageSchema = z.object({
  body: z
    .string()
    .min(1, 'Message body is required.')
    .max(2000, 'Message must be at most 2000 characters.')
    .trim(),
});

export const chatQuerySchema = z.object({
  page: z.coerce.number().int().positive().default(1),
  limit: z.coerce.number().int().positive().max(100).default(50),
  before: z.coerce.date().optional(),
});

// ---------------------------------------------------------------------------
// Device schemas
// ---------------------------------------------------------------------------

export const registerDeviceSchema = z.object({
  platform: z.enum(['ios', 'android', 'web']),
  deviceName: z.string().max(255).optional(),
  pushToken: z.string().max(512).optional(),
  voipToken: z.string().max(512).optional(),
  appVersion: z.string().max(50).optional(),
});

// ---------------------------------------------------------------------------
// Participant schemas
// ---------------------------------------------------------------------------

export const updateMediaSchema = z.object({
  micEnabled: z.boolean().optional(),
  cameraEnabled: z.boolean().optional(),
});

// ---------------------------------------------------------------------------
// Socket event payload schemas
// ---------------------------------------------------------------------------

export const socketMeetingJoinSchema = z.object({
  meetingId: uuidSchema,
});

export const socketMeetingLeaveSchema = z.object({
  meetingId: uuidSchema,
});

export const socketWebRTCOfferSchema = z.object({
  meetingId: uuidSchema,
  targetUserId: uuidSchema,
  sdp: z.string().min(1, 'SDP is required.'),
  messageId: z.string().min(1, 'Message ID is required.'),
});

export const socketWebRTCAnswerSchema = z.object({
  meetingId: uuidSchema,
  targetUserId: uuidSchema,
  sdp: z.string().min(1, 'SDP is required.'),
  messageId: z.string().min(1, 'Message ID is required.'),
});

export const socketWebRTCIceCandidateSchema = z.object({
  meetingId: uuidSchema,
  targetUserId: uuidSchema,
  candidate: z.string().min(1, 'Candidate is required.'),
  sdpMid: z.string().nullable(),
  sdpMLineIndex: z.number().int().nullable(),
  messageId: z.string().min(1, 'Message ID is required.'),
});

export const socketChatSendSchema = z.object({
  meetingId: uuidSchema,
  body: z
    .string()
    .min(1, 'Message body is required.')
    .max(2000, 'Message must be at most 2000 characters.'),
});

export const socketMediaUpdateSchema = z.object({
  meetingId: uuidSchema,
  micEnabled: z.boolean().optional(),
  cameraEnabled: z.boolean().optional(),
});

// ---------------------------------------------------------------------------
// Type exports
// ---------------------------------------------------------------------------

export type LoginInput = z.infer<typeof loginSchema>;
export type RegisterInput = z.infer<typeof registerSchema>;
export type RefreshTokenInput = z.infer<typeof refreshTokenSchema>;
export type CreateMeetingInput = z.infer<typeof createMeetingSchema>;
export type JoinMeetingInput = z.infer<typeof joinMeetingSchema>;
export type SendChatMessageInput = z.infer<typeof sendChatMessageSchema>;
export type ChatQueryInput = z.infer<typeof chatQuerySchema>;
export type RegisterDeviceInput = z.infer<typeof registerDeviceSchema>;
export type UpdateMediaInput = z.infer<typeof updateMediaSchema>;
export type PaginationInput = z.infer<typeof paginationSchema>;
