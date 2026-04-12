import { nanoid } from 'nanoid';
import {
  MeetingStatus,
  ParticipantRole,
  ErrorCode,
  AuditEvent,
  Limits,
  MEETING_STATUS_TRANSITIONS,
  type MeetingStatusType,
} from '../../config/constants.js';
import * as meetingsRepo from './meetings.repository.js';
import { auditQueue } from '../../infrastructure/queue/queue.js';
import { activeMeetingsGauge, meetingJoinTotal, meetingJoinFailures } from '../../logging/metrics.js';
import { logger } from '../../logging/logger.js';
import type { ServiceResult, PaginatedResult } from '../../common/types.js';
import { success, failure, buildPaginatedResult } from '../../common/types.js';

const log = logger.child({ module: 'meetings.service' });

// ---------------------------------------------------------------------------
// Create meeting
// ---------------------------------------------------------------------------

interface CreateMeetingResult {
  id: string;
  code: string;
  title: string | null;
  status: string;
  hostUserId: string;
  createdAt: Date;
}

export async function createMeeting(
  hostUserId: string,
  title?: string,
  meta?: { ipAddress?: string; userAgent?: string },
): Promise<ServiceResult<CreateMeetingResult>> {
  // Generate a unique, human-friendly meeting code
  const code = nanoid(Limits.MEETING_CODE_LENGTH);

  const meeting = await meetingsRepo.createMeeting({
    code,
    hostUserId,
    title,
  });

  activeMeetingsGauge.inc();

  // Audit
  await auditQueue.add('meeting-created', {
    actorUserId: hostUserId,
    meetingId: meeting.id,
    eventType: AuditEvent.MEETING_CREATED,
    payload: { code: meeting.code, title },
    ipAddress: meta?.ipAddress,
    userAgent: meta?.userAgent,
    timestamp: new Date().toISOString(),
  });

  log.info({ meetingId: meeting.id, code: meeting.code, hostUserId }, 'Meeting created');

  return success({
    id: meeting.id,
    code: meeting.code,
    title: meeting.title,
    status: meeting.status,
    hostUserId: meeting.hostUserId,
    createdAt: meeting.createdAt,
  });
}

// ---------------------------------------------------------------------------
// Get meeting
// ---------------------------------------------------------------------------

export async function getMeeting(meetingId: string): Promise<ServiceResult<meetingsRepo.MeetingWithDetails>> {
  const meeting = await meetingsRepo.findMeetingWithDetails(meetingId);
  if (!meeting) {
    return failure(ErrorCode.MEETING_NOT_FOUND, 'The meeting does not exist or is no longer available.', 404);
  }
  return success(meeting);
}

// ---------------------------------------------------------------------------
// Get meeting by code
// ---------------------------------------------------------------------------

export async function getMeetingByCode(code: string): Promise<ServiceResult<meetingsRepo.MeetingWithDetails>> {
  const meeting = await meetingsRepo.findMeetingByCode(code);
  if (!meeting) {
    return failure(ErrorCode.MEETING_NOT_FOUND, 'The meeting does not exist or is no longer available.', 404);
  }
  const details = await meetingsRepo.findMeetingWithDetails(meeting.id);
  if (!details) {
    return failure(ErrorCode.MEETING_NOT_FOUND, 'The meeting does not exist or is no longer available.', 404);
  }
  return success(details);
}

// ---------------------------------------------------------------------------
// Join meeting
// ---------------------------------------------------------------------------

interface JoinMeetingResult {
  participantId: string;
  meetingId: string;
  role: string;
  meeting: {
    id: string;
    code: string;
    title: string | null;
    status: string;
    hostUserId: string;
  };
}

export async function joinMeeting(
  meetingId: string,
  userId: string,
  meta?: { ipAddress?: string; userAgent?: string },
): Promise<ServiceResult<JoinMeetingResult>> {
  // Validate meeting exists
  const meeting = await meetingsRepo.findMeetingById(meetingId);
  if (!meeting) {
    meetingJoinTotal.inc({ status: 'failure' });
    meetingJoinFailures.inc({ reason: 'not_found' });
    return failure(ErrorCode.MEETING_NOT_FOUND, 'The meeting does not exist.', 404);
  }

  // Validate meeting status
  if (meeting.status === MeetingStatus.ENDED || meeting.status === MeetingStatus.ENDING) {
    meetingJoinTotal.inc({ status: 'failure' });
    meetingJoinFailures.inc({ reason: 'already_ended' });
    return failure(ErrorCode.MEETING_ALREADY_ENDED, 'This meeting has already ended.', 400);
  }

  // Check for duplicate join (prevent re-joining if already active)
  const existingParticipant = await meetingsRepo.findActiveParticipant(meetingId, userId);
  if (existingParticipant) {
    // Idempotent: return existing participation (supports reconnects)
    meetingJoinTotal.inc({ status: 'success' });
    log.info({ meetingId, userId }, 'User re-joined meeting (idempotent)');

    return success({
      participantId: existingParticipant.id,
      meetingId: existingParticipant.meetingId,
      role: existingParticipant.role,
      meeting: {
        id: meeting.id,
        code: meeting.code,
        title: meeting.title,
        status: meeting.status,
        hostUserId: meeting.hostUserId,
      },
    });
  }

  // Check participant limit
  const currentCount = await meetingsRepo.getActiveParticipantCount(meetingId);
  if (currentCount >= Limits.MAX_PARTICIPANTS_PER_MEETING) {
    meetingJoinTotal.inc({ status: 'failure' });
    meetingJoinFailures.inc({ reason: 'meeting_full' });
    return failure(ErrorCode.MEETING_FULL, 'This meeting has reached the maximum number of participants.', 400);
  }

  // Determine role
  const role = meeting.hostUserId === userId ? ParticipantRole.HOST : ParticipantRole.PARTICIPANT;

  // Add participant
  const participant = await meetingsRepo.addParticipant({
    meetingId,
    userId,
    role,
  });

  // Transition meeting status if needed
  if (meeting.status === MeetingStatus.CREATED) {
    await transitionMeetingStatus(meetingId, MeetingStatus.CREATED, MeetingStatus.WAITING);
  }
  if (meeting.status === MeetingStatus.WAITING || meeting.status === MeetingStatus.CREATED) {
    const count = await meetingsRepo.getActiveParticipantCount(meetingId);
    if (count >= 2) {
      await transitionMeetingStatus(meetingId, meeting.status as MeetingStatusType, MeetingStatus.ACTIVE, {
        startedAt: new Date(),
      });
    }
  }

  meetingJoinTotal.inc({ status: 'success' });

  // Audit
  await auditQueue.add('meeting-joined', {
    actorUserId: userId,
    meetingId,
    eventType: AuditEvent.MEETING_JOINED,
    payload: { role, participantId: participant.id },
    ipAddress: meta?.ipAddress,
    userAgent: meta?.userAgent,
    timestamp: new Date().toISOString(),
  });

  log.info({ meetingId, userId, participantId: participant.id, role }, 'User joined meeting');

  return success({
    participantId: participant.id,
    meetingId: participant.meetingId,
    role: participant.role,
    meeting: {
      id: meeting.id,
      code: meeting.code,
      title: meeting.title,
      status: meeting.status,
      hostUserId: meeting.hostUserId,
    },
  });
}

// ---------------------------------------------------------------------------
// Leave meeting
// ---------------------------------------------------------------------------

interface LeaveMeetingResult {
  left: boolean;
  meetingEnded: boolean;
  newHostUserId?: string;
}

export async function leaveMeeting(
  meetingId: string,
  userId: string,
  meta?: { ipAddress?: string; userAgent?: string },
): Promise<ServiceResult<LeaveMeetingResult>> {
  const meeting = await meetingsRepo.findMeetingById(meetingId);
  if (!meeting) {
    return failure(ErrorCode.MEETING_NOT_FOUND, 'Meeting not found.', 404);
  }

  // Mark participant as left
  const participant = await meetingsRepo.markParticipantLeft(meetingId, userId);
  if (!participant) {
    return failure(ErrorCode.NOT_A_PARTICIPANT, 'You are not in this meeting.', 403);
  }

  // Check remaining participants
  const remainingCount = await meetingsRepo.getActiveParticipantCount(meetingId);

  let meetingEnded = false;
  let newHostUserId: string | undefined;

  if (remainingCount === 0) {
    // No participants left — end meeting
    await endMeeting(meetingId, userId, meta);
    meetingEnded = true;
  } else if (meeting.hostUserId === userId) {
    // Host is leaving — transfer host role
    const nextHost = await meetingsRepo.findNextHost(meetingId, userId);
    if (nextHost) {
      await meetingsRepo.updateParticipantRole(meetingId, nextHost.userId, ParticipantRole.HOST);
      await meetingsRepo.updateMeetingStatus(meetingId, meeting.status, {
        hostUserId: nextHost.userId,
      });
      newHostUserId = nextHost.userId;

      await auditQueue.add('host-transferred', {
        actorUserId: userId,
        meetingId,
        eventType: AuditEvent.MEETING_HOST_TRANSFERRED,
        payload: { fromUserId: userId, toUserId: nextHost.userId },
        ipAddress: meta?.ipAddress,
        userAgent: meta?.userAgent,
        timestamp: new Date().toISOString(),
      });

      log.info({ meetingId, fromUserId: userId, toUserId: nextHost.userId }, 'Host transferred');
    } else {
      // No eligible host — end meeting
      await endMeeting(meetingId, userId, meta);
      meetingEnded = true;
    }
  }

  // Audit
  await auditQueue.add('meeting-left', {
    actorUserId: userId,
    meetingId,
    eventType: AuditEvent.MEETING_LEFT,
    payload: { meetingEnded, newHostUserId },
    ipAddress: meta?.ipAddress,
    userAgent: meta?.userAgent,
    timestamp: new Date().toISOString(),
  });

  log.info({ meetingId, userId, meetingEnded, newHostUserId }, 'User left meeting');

  return success({ left: true, meetingEnded, newHostUserId });
}

// ---------------------------------------------------------------------------
// End meeting (idempotent)
// ---------------------------------------------------------------------------

export async function endMeeting(
  meetingId: string,
  userId: string,
  meta?: { ipAddress?: string; userAgent?: string },
): Promise<ServiceResult<{ ended: boolean }>> {
  const meeting = await meetingsRepo.findMeetingById(meetingId);
  if (!meeting) {
    return failure(ErrorCode.MEETING_NOT_FOUND, 'Meeting not found.', 404);
  }

  // Idempotent: already ended is a success
  if (meeting.status === MeetingStatus.ENDED) {
    return success({ ended: true });
  }

  // Transition to ending, then ended
  if (meeting.status !== MeetingStatus.ENDING) {
    await transitionMeetingStatus(meetingId, meeting.status as MeetingStatusType, MeetingStatus.ENDING);
  }

  // Mark all remaining participants as left
  await meetingsRepo.markAllParticipantsLeft(meetingId);

  // Final status
  await meetingsRepo.updateMeetingStatus(meetingId, MeetingStatus.ENDED, {
    endedAt: new Date(),
  });

  activeMeetingsGauge.dec();

  // Audit
  await auditQueue.add('meeting-ended', {
    actorUserId: userId,
    meetingId,
    eventType: AuditEvent.MEETING_ENDED,
    payload: {},
    ipAddress: meta?.ipAddress,
    userAgent: meta?.userAgent,
    timestamp: new Date().toISOString(),
  });

  log.info({ meetingId }, 'Meeting ended');

  return success({ ended: true });
}

// ---------------------------------------------------------------------------
// Meeting history
// ---------------------------------------------------------------------------

export async function getMeetingHistory(
  userId: string,
  page: number,
  limit: number,
): Promise<ServiceResult<PaginatedResult<meetingsRepo.MeetingWithParticipantCount>>> {
  const { meetings, total } = await meetingsRepo.findMeetingsByUser(userId, page, limit);
  return success(buildPaginatedResult(meetings, total, { page, limit }));
}

// ---------------------------------------------------------------------------
// Meeting status transitions with validation
// ---------------------------------------------------------------------------

async function transitionMeetingStatus(
  meetingId: string,
  currentStatus: MeetingStatusType,
  targetStatus: MeetingStatusType,
  additionalData?: Partial<Pick<import('@prisma/client').Meeting, 'startedAt' | 'endedAt' | 'hostUserId'>>,
): Promise<void> {
  const validTransitions = MEETING_STATUS_TRANSITIONS[currentStatus];
  if (!validTransitions?.includes(targetStatus)) {
    log.warn(
      { meetingId, currentStatus, targetStatus },
      'Invalid meeting status transition attempted',
    );
    return; // Silently skip invalid transitions for idempotency
  }

  await meetingsRepo.updateMeetingStatus(meetingId, targetStatus, additionalData);
  log.debug({ meetingId, from: currentStatus, to: targetStatus }, 'Meeting status transitioned');
}
