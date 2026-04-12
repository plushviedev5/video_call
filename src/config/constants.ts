// ============================================================================
// Application Constants — single source of truth for enums, codes, and limits
// ============================================================================

// ---------------------------------------------------------------------------
// Meeting lifecycle statuses
// ---------------------------------------------------------------------------
export const MeetingStatus = {
  CREATED: 'created',
  WAITING: 'waiting',
  ACTIVE: 'active',
  ENDING: 'ending',
  ENDED: 'ended',
} as const;

export type MeetingStatusType = (typeof MeetingStatus)[keyof typeof MeetingStatus];

/** Valid transitions: key can move to any value in the array */
export const MEETING_STATUS_TRANSITIONS: Record<MeetingStatusType, MeetingStatusType[]> = {
  [MeetingStatus.CREATED]: [MeetingStatus.WAITING, MeetingStatus.ENDED],
  [MeetingStatus.WAITING]: [MeetingStatus.ACTIVE, MeetingStatus.ENDED],
  [MeetingStatus.ACTIVE]: [MeetingStatus.ENDING, MeetingStatus.ENDED],
  [MeetingStatus.ENDING]: [MeetingStatus.ENDED],
  [MeetingStatus.ENDED]: [],
};

// ---------------------------------------------------------------------------
// Participant roles
// ---------------------------------------------------------------------------
export const ParticipantRole = {
  HOST: 'host',
  CO_HOST: 'co_host',
  PARTICIPANT: 'participant',
} as const;

export type ParticipantRoleType = (typeof ParticipantRole)[keyof typeof ParticipantRole];

// ---------------------------------------------------------------------------
// Device platforms
// ---------------------------------------------------------------------------
export const DevicePlatform = {
  IOS: 'ios',
  ANDROID: 'android',
  WEB: 'web',
} as const;

export type DevicePlatformType = (typeof DevicePlatform)[keyof typeof DevicePlatform];

// ---------------------------------------------------------------------------
// Audit event types
// ---------------------------------------------------------------------------
export const AuditEvent = {
  // Auth
  USER_LOGIN: 'user.login',
  USER_LOGOUT: 'user.logout',
  TOKEN_REFRESH: 'token.refresh',

  // Meetings
  MEETING_CREATED: 'meeting.created',
  MEETING_JOINED: 'meeting.joined',
  MEETING_LEFT: 'meeting.left',
  MEETING_ENDED: 'meeting.ended',
  MEETING_HOST_TRANSFERRED: 'meeting.host_transferred',

  // Participants
  PARTICIPANT_MEDIA_UPDATED: 'participant.media_updated',
  PARTICIPANT_ROLE_CHANGED: 'participant.role_changed',

  // Chat
  CHAT_MESSAGE_SENT: 'chat.message_sent',

  // Devices
  DEVICE_REGISTERED: 'device.registered',

  // Signaling
  SIGNALING_OFFER: 'signaling.offer',
  SIGNALING_ANSWER: 'signaling.answer',
  SIGNALING_ICE: 'signaling.ice_candidate',
} as const;

export type AuditEventType = (typeof AuditEvent)[keyof typeof AuditEvent];

// ---------------------------------------------------------------------------
// Error codes — machine-readable, stable identifiers
// ---------------------------------------------------------------------------
export const ErrorCode = {
  // Generic
  INTERNAL_ERROR: 'INTERNAL_ERROR',
  VALIDATION_ERROR: 'VALIDATION_ERROR',
  NOT_FOUND: 'NOT_FOUND',
  UNAUTHORIZED: 'UNAUTHORIZED',
  FORBIDDEN: 'FORBIDDEN',
  RATE_LIMIT_EXCEEDED: 'RATE_LIMIT_EXCEEDED',
  CONFLICT: 'CONFLICT',

  // Auth
  INVALID_CREDENTIALS: 'INVALID_CREDENTIALS',
  TOKEN_EXPIRED: 'TOKEN_EXPIRED',
  TOKEN_INVALID: 'TOKEN_INVALID',
  REFRESH_TOKEN_INVALID: 'REFRESH_TOKEN_INVALID',
  REFRESH_TOKEN_EXPIRED: 'REFRESH_TOKEN_EXPIRED',
  SESSION_NOT_FOUND: 'SESSION_NOT_FOUND',
  SESSION_REVOKED: 'SESSION_REVOKED',

  // Users
  USER_NOT_FOUND: 'USER_NOT_FOUND',
  USER_ALREADY_EXISTS: 'USER_ALREADY_EXISTS',
  USER_DISABLED: 'USER_DISABLED',

  // Meetings
  MEETING_NOT_FOUND: 'MEETING_NOT_FOUND',
  MEETING_ALREADY_ENDED: 'MEETING_ALREADY_ENDED',
  MEETING_FULL: 'MEETING_FULL',
  MEETING_INVALID_STATUS: 'MEETING_INVALID_STATUS',
  MEETING_CODE_INVALID: 'MEETING_CODE_INVALID',

  // Participants
  ALREADY_JOINED: 'ALREADY_JOINED',
  NOT_A_PARTICIPANT: 'NOT_A_PARTICIPANT',
  INSUFFICIENT_ROLE: 'INSUFFICIENT_ROLE',

  // Chat
  CHAT_MESSAGE_TOO_LONG: 'CHAT_MESSAGE_TOO_LONG',
  CHAT_SEND_FAILED: 'CHAT_SEND_FAILED',

  // Devices
  DEVICE_REGISTRATION_FAILED: 'DEVICE_REGISTRATION_FAILED',

  // Socket
  SOCKET_AUTH_FAILED: 'SOCKET_AUTH_FAILED',
  SOCKET_ROOM_NOT_FOUND: 'SOCKET_ROOM_NOT_FOUND',
  SOCKET_NOT_IN_ROOM: 'SOCKET_NOT_IN_ROOM',
} as const;

export type ErrorCodeType = (typeof ErrorCode)[keyof typeof ErrorCode];

// ---------------------------------------------------------------------------
// Socket.IO event names
// ---------------------------------------------------------------------------
export const SocketEvent = {
  // Client → Server
  CONNECTION_INIT: 'connection:init',
  MEETING_JOIN: 'meeting:join',
  MEETING_LEAVE: 'meeting:leave',
  WEBRTC_OFFER: 'webrtc:offer',
  WEBRTC_ANSWER: 'webrtc:answer',
  WEBRTC_ICE_CANDIDATE: 'webrtc:ice-candidate',
  CHAT_SEND: 'chat:send',
  PARTICIPANT_UPDATE_MEDIA: 'participant:update-media',

  // Server → Client
  MEETING_JOINED: 'meeting:joined',
  PARTICIPANT_JOINED: 'participant:joined',
  PARTICIPANT_LEFT: 'participant:left',
  PARTICIPANT_MEDIA_UPDATED: 'participant:media-updated',
  MEETING_ENDED: 'meeting:ended',
  CHAT_MESSAGE: 'chat:message',
  ERROR: 'error:message',
} as const;

// ---------------------------------------------------------------------------
// Redis key prefixes
// ---------------------------------------------------------------------------
export const RedisKey = {
  userSockets: (userId: string) => `user:${userId}:sockets`,
  meetingParticipants: (meetingId: string) => `meeting:${meetingId}:participants`,
  rateLimitBucket: (action: string, key: string) => `ratelimit:${action}:${key}`,
  signalingDedup: (meetingId: string, msgId: string) => `dedup:${meetingId}:${msgId}`,
} as const;

// ---------------------------------------------------------------------------
// Limits
// ---------------------------------------------------------------------------
export const Limits = {
  MEETING_CODE_LENGTH: 10,
  CHAT_MESSAGE_MAX_LENGTH: 2000,
  MAX_PARTICIPANTS_PER_MEETING: 100,
  SIGNALING_DEDUP_TTL_SECONDS: 30,
  PRESENCE_TTL_SECONDS: 300, // 5 minutes
  MAX_SESSIONS_PER_USER: 5,
  MAX_DEVICES_PER_USER: 10,
} as const;

// ---------------------------------------------------------------------------
// Queue names
// ---------------------------------------------------------------------------
export const QueueName = {
  NOTIFICATIONS: 'notifications',
  AUDIT: 'audit',
} as const;
