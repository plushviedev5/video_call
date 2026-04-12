import { ErrorCode, AuditEvent, MeetingStatus } from '../../config/constants.js';
import * as chatRepo from './chat.repository.js';
import * as meetingsRepo from '../meetings/meetings.repository.js';
import { auditQueue } from '../../infrastructure/queue/queue.js';
import { logger } from '../../logging/logger.js';
import type { ServiceResult, PaginatedResult } from '../../common/types.js';
import { success, failure, buildPaginatedResult } from '../../common/types.js';

const log = logger.child({ module: 'chat.service' });

// ---------------------------------------------------------------------------
// Chat message type (safe for client)
// ---------------------------------------------------------------------------

export interface ChatMessageDTO {
  id: string;
  meetingId: string;
  body: string;
  createdAt: Date;
  sender: {
    id: string;
    name: string;
    avatarUrl: string | null;
  };
}

// ---------------------------------------------------------------------------
// Send message — persist BEFORE broadcast
// ---------------------------------------------------------------------------

export async function sendMessage(
  meetingId: string,
  senderUserId: string,
  body: string,
  meta?: { ipAddress?: string; userAgent?: string },
): Promise<ServiceResult<ChatMessageDTO>> {
  // Validate meeting exists and is active
  const meeting = await meetingsRepo.findMeetingById(meetingId);
  if (!meeting) {
    return failure(ErrorCode.MEETING_NOT_FOUND, 'Meeting not found.', 404);
  }

  if (meeting.status === MeetingStatus.ENDED) {
    return failure(ErrorCode.MEETING_ALREADY_ENDED, 'Cannot send messages to an ended meeting.', 400);
  }

  // Validate sender is a participant
  const participant = await meetingsRepo.findActiveParticipant(meetingId, senderUserId);
  if (!participant) {
    return failure(ErrorCode.NOT_A_PARTICIPANT, 'You are not a participant in this meeting.', 403);
  }

  // Persist message
  const message = await chatRepo.createMessage({
    meetingId,
    senderUserId,
    body,
  });

  // Audit (async, non-blocking)
  auditQueue
    .add('chat-sent', {
      actorUserId: senderUserId,
      meetingId,
      eventType: AuditEvent.CHAT_MESSAGE_SENT,
      payload: { messageId: message.id },
      ipAddress: meta?.ipAddress,
      userAgent: meta?.userAgent,
      timestamp: new Date().toISOString(),
    })
    .catch((err) => log.error({ error: err }, 'Failed to queue chat audit'));

  log.debug({ meetingId, messageId: message.id }, 'Chat message persisted');

  return success({
    id: message.id,
    meetingId: message.meetingId,
    body: message.body,
    createdAt: message.createdAt,
    sender: message.sender,
  });
}

// ---------------------------------------------------------------------------
// Get chat history (paginated)
// ---------------------------------------------------------------------------

export async function getChatHistory(
  meetingId: string,
  userId: string,
  page: number,
  limit: number,
  before?: Date,
): Promise<ServiceResult<PaginatedResult<ChatMessageDTO>>> {
  // Validate meeting exists
  const meeting = await meetingsRepo.findMeetingById(meetingId);
  if (!meeting) {
    return failure(ErrorCode.MEETING_NOT_FOUND, 'Meeting not found.', 404);
  }

  const { messages, total } = await chatRepo.getMessagesByMeeting(
    meetingId,
    page,
    limit,
    before,
  );

  const dtos: ChatMessageDTO[] = messages.map((m) => ({
    id: m.id,
    meetingId: m.meetingId,
    body: m.body,
    createdAt: m.createdAt,
    sender: m.sender,
  }));

  return success(buildPaginatedResult(dtos, total, { page, limit }));
}
