import { ErrorCode, AuditEvent } from '../../config/constants.js';
import * as meetingsRepo from '../meetings/meetings.repository.js';
import { auditQueue } from '../../infrastructure/queue/queue.js';
import { logger } from '../../logging/logger.js';
import type { ServiceResult } from '../../common/types.js';
import { success, failure } from '../../common/types.js';

const log = logger.child({ module: 'participants.service' });

// ---------------------------------------------------------------------------
// Participant types
// ---------------------------------------------------------------------------

export interface ParticipantInfo {
  id: string;
  userId: string;
  meetingId: string;
  role: string;
  joinedAt: Date;
  micEnabled: boolean;
  cameraEnabled: boolean;
  user: {
    id: string;
    name: string;
    email: string;
    avatarUrl: string | null;
  };
}

// ---------------------------------------------------------------------------
// Get active participants
// ---------------------------------------------------------------------------

export async function getActiveParticipants(
  meetingId: string,
): Promise<ServiceResult<ParticipantInfo[]>> {
  const meeting = await meetingsRepo.findMeetingById(meetingId);
  if (!meeting) {
    return failure(ErrorCode.MEETING_NOT_FOUND, 'Meeting not found.', 404);
  }

  const participants = await meetingsRepo.getActiveParticipants(meetingId);

  return success(
    participants.map((p) => ({
      id: p.id,
      userId: p.userId,
      meetingId: p.meetingId,
      role: p.role,
      joinedAt: p.joinedAt,
      micEnabled: p.micEnabled,
      cameraEnabled: p.cameraEnabled,
      user: p.user,
    })),
  );
}

// ---------------------------------------------------------------------------
// Update media flags (mic/camera)
// ---------------------------------------------------------------------------

export async function updateMedia(
  meetingId: string,
  userId: string,
  data: { micEnabled?: boolean; cameraEnabled?: boolean },
  meta?: { ipAddress?: string; userAgent?: string },
): Promise<ServiceResult<{ updated: boolean; micEnabled: boolean; cameraEnabled: boolean }>> {
  const participant = await meetingsRepo.findActiveParticipant(meetingId, userId);
  if (!participant) {
    return failure(ErrorCode.NOT_A_PARTICIPANT, 'Not a participant in this meeting.', 403);
  }

  const updated = await meetingsRepo.updateParticipantMedia(meetingId, userId, data);
  if (!updated) {
    return failure(ErrorCode.INTERNAL_ERROR, 'Failed to update media.', 500);
  }

  // Audit
  await auditQueue.add('media-updated', {
    actorUserId: userId,
    meetingId,
    eventType: AuditEvent.PARTICIPANT_MEDIA_UPDATED,
    payload: data,
    ipAddress: meta?.ipAddress,
    userAgent: meta?.userAgent,
    timestamp: new Date().toISOString(),
  });

  log.debug({ meetingId, userId, ...data }, 'Participant media updated');

  return success({
    updated: true,
    micEnabled: updated.micEnabled,
    cameraEnabled: updated.cameraEnabled,
  });
}

// ---------------------------------------------------------------------------
// Change participant role
// ---------------------------------------------------------------------------

export async function changeRole(
  meetingId: string,
  targetUserId: string,
  newRole: string,
  actorUserId: string,
  meta?: { ipAddress?: string; userAgent?: string },
): Promise<ServiceResult<{ updated: boolean; role: string }>> {
  // Verify actor is host
  const actor = await meetingsRepo.findActiveParticipant(meetingId, actorUserId);
  if (!actor || actor.role !== 'host') {
    return failure(ErrorCode.INSUFFICIENT_ROLE, 'Only the host can change participant roles.', 403);
  }

  const updated = await meetingsRepo.updateParticipantRole(meetingId, targetUserId, newRole);
  if (!updated) {
    return failure(ErrorCode.NOT_A_PARTICIPANT, 'Target user is not in this meeting.', 404);
  }

  // Audit
  await auditQueue.add('role-changed', {
    actorUserId,
    meetingId,
    eventType: AuditEvent.PARTICIPANT_ROLE_CHANGED,
    payload: { targetUserId, newRole },
    ipAddress: meta?.ipAddress,
    userAgent: meta?.userAgent,
    timestamp: new Date().toISOString(),
  });

  log.info({ meetingId, targetUserId, newRole, actorUserId }, 'Participant role changed');

  return success({ updated: true, role: updated.role });
}
