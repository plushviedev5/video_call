import { ErrorCode, AuditEvent } from '../../config/constants.js';
import * as meetingsRepo from '../meetings/meetings.repository.js';
import { checkSignalingDedup } from '../../infrastructure/redis/rate-limiter.js';
import {
  getMeetingParticipant,
  setMeetingParticipant,
  removeMeetingParticipant,
  updateParticipantMedia as updatePresenceMedia,
  type MeetingPresenceData,
} from '../../infrastructure/redis/presence.js';
import { auditQueue } from '../../infrastructure/queue/queue.js';
import { logger } from '../../logging/logger.js';
import type { ServiceResult } from '../../common/types.js';
import { success, failure } from '../../common/types.js';

const log = logger.child({ module: 'signaling.service' });

// ---------------------------------------------------------------------------
// Validate room membership
// ---------------------------------------------------------------------------

export async function validateRoomMembership(
  meetingId: string,
  userId: string,
): Promise<ServiceResult<MeetingPresenceData>> {
  const presence = await getMeetingParticipant(meetingId, userId);

  if (!presence) {
    return failure(
      ErrorCode.SOCKET_NOT_IN_ROOM,
      'You are not in this meeting room.',
      403,
    );
  }

  return success(presence);
}

// ---------------------------------------------------------------------------
// Join room
// ---------------------------------------------------------------------------

export async function joinRoom(
  meetingId: string,
  userId: string,
  socketId: string,
  userName: string,
  role: string,
): Promise<ServiceResult<{ participants: MeetingPresenceData[] }>> {
  // Verify meeting exists and is joinable
  const meeting = await meetingsRepo.findMeetingById(meetingId);
  if (!meeting) {
    return failure(ErrorCode.MEETING_NOT_FOUND, 'Meeting not found.', 404);
  }

  if (meeting.status === 'ended' || meeting.status === 'ending') {
    return failure(ErrorCode.MEETING_ALREADY_ENDED, 'Meeting has ended.', 400);
  }

  // Set presence
  const presenceData: MeetingPresenceData = {
    userId,
    socketId,
    joinedAt: new Date().toISOString(),
    micEnabled: false,
    cameraEnabled: false,
    role,
    name: userName,
  };

  await setMeetingParticipant(meetingId, userId, presenceData);

  // Get all current participants from presence
  const { getMeetingParticipants } = await import('../../infrastructure/redis/presence.js');
  const participants = await getMeetingParticipants(meetingId);

  log.info({ meetingId, userId, socketId }, 'User joined signaling room');

  return success({ participants });
}

// ---------------------------------------------------------------------------
// Leave room
// ---------------------------------------------------------------------------

export async function leaveRoom(
  meetingId: string,
  userId: string,
): Promise<ServiceResult<{ left: boolean }>> {
  await removeMeetingParticipant(meetingId, userId);
  log.info({ meetingId, userId }, 'User left signaling room');
  return success({ left: true });
}

// ---------------------------------------------------------------------------
// Validate and deduplicate signaling message
// ---------------------------------------------------------------------------

export async function validateSignalingMessage(
  meetingId: string,
  senderUserId: string,
  targetUserId: string,
  messageId: string,
): Promise<ServiceResult<{ targetSocketId: string }>> {
  // Validate sender is in the room
  const senderPresence = await getMeetingParticipant(meetingId, senderUserId);
  if (!senderPresence) {
    return failure(ErrorCode.SOCKET_NOT_IN_ROOM, 'Sender is not in this meeting.', 403);
  }

  // Validate target is in the room
  const targetPresence = await getMeetingParticipant(meetingId, targetUserId);
  if (!targetPresence) {
    return failure(ErrorCode.SOCKET_NOT_IN_ROOM, 'Target user is not in this meeting.', 404);
  }

  // Deduplicate
  const isNew = await checkSignalingDedup(meetingId, messageId);
  if (!isNew) {
    return failure(ErrorCode.CONFLICT, 'Duplicate signaling message.', 409);
  }

  return success({ targetSocketId: targetPresence.socketId });
}

// ---------------------------------------------------------------------------
// Update media in presence
// ---------------------------------------------------------------------------

export async function updateMediaPresence(
  meetingId: string,
  userId: string,
  updates: { micEnabled?: boolean; cameraEnabled?: boolean },
): Promise<ServiceResult<MeetingPresenceData>> {
  const updated = await updatePresenceMedia(meetingId, userId, updates);
  if (!updated) {
    return failure(ErrorCode.NOT_A_PARTICIPANT, 'Not in this meeting.', 403);
  }

  log.debug({ meetingId, userId, ...updates }, 'Media presence updated');
  return success(updated);
}
