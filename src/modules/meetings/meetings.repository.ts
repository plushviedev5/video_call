import { getPrismaClient } from '../../infrastructure/db/prisma.js';
import type { Meeting, MeetingParticipant, Prisma } from '@prisma/client';

// ---------------------------------------------------------------------------
// Meeting queries
// ---------------------------------------------------------------------------

export async function createMeeting(data: {
  code: string;
  hostUserId: string;
  title?: string;
}): Promise<Meeting> {
  return getPrismaClient().meeting.create({ data });
}

export async function findMeetingById(id: string): Promise<Meeting | null> {
  return getPrismaClient().meeting.findUnique({ where: { id } });
}

export async function findMeetingByCode(code: string): Promise<Meeting | null> {
  return getPrismaClient().meeting.findUnique({ where: { code } });
}

export async function updateMeetingStatus(
  id: string,
  status: string,
  additionalData?: Partial<Pick<Meeting, 'startedAt' | 'endedAt' | 'hostUserId'>>,
): Promise<Meeting> {
  return getPrismaClient().meeting.update({
    where: { id },
    data: {
      status: status as Meeting['status'],
      ...additionalData,
    },
  });
}

export async function findMeetingsByUser(
  userId: string,
  page: number,
  limit: number,
): Promise<{ meetings: MeetingWithParticipantCount[]; total: number }> {
  const where: Prisma.MeetingWhereInput = {
    OR: [
      { hostUserId: userId },
      { participants: { some: { userId } } },
    ],
  };

  const [meetings, total] = await Promise.all([
    getPrismaClient().meeting.findMany({
      where,
      orderBy: { createdAt: 'desc' },
      skip: (page - 1) * limit,
      take: limit,
      include: {
        _count: { select: { participants: true } },
        host: {
          select: { id: true, name: true, email: true, avatarUrl: true },
        },
      },
    }),
    getPrismaClient().meeting.count({ where }),
  ]);

  return {
    meetings: meetings.map((m) => ({
      ...m,
      participantCount: m._count.participants,
    })) as unknown as MeetingWithParticipantCount[],
    total,
  };
}

export interface MeetingWithParticipantCount extends Meeting {
  participantCount: number;
  host: { id: string; name: string; email: string; avatarUrl: string | null };
}

export async function findMeetingWithDetails(id: string): Promise<MeetingWithDetails | null> {
  const meeting = await getPrismaClient().meeting.findUnique({
    where: { id },
    include: {
      host: {
        select: { id: true, name: true, email: true, avatarUrl: true },
      },
      participants: {
        where: { leftAt: null },
        include: {
          user: {
            select: { id: true, name: true, email: true, avatarUrl: true },
          },
        },
        orderBy: { joinedAt: 'asc' },
      },
      _count: { select: { participants: true } },
    },
  });

  if (!meeting) return null;

  return meeting as unknown as MeetingWithDetails;
}

export interface MeetingWithDetails extends Meeting {
  host: { id: string; name: string; email: string; avatarUrl: string | null };
  participants: (MeetingParticipant & {
    user: { id: string; name: string; email: string; avatarUrl: string | null };
  })[];
  _count: { participants: number };
}

// ---------------------------------------------------------------------------
// Participant queries
// ---------------------------------------------------------------------------

export async function addParticipant(data: {
  meetingId: string;
  userId: string;
  role: string;
  micEnabled?: boolean;
  cameraEnabled?: boolean;
}): Promise<MeetingParticipant> {
  return getPrismaClient().meetingParticipant.create({
    data: {
      meetingId: data.meetingId,
      userId: data.userId,
      role: data.role as MeetingParticipant['role'],
      micEnabled: data.micEnabled ?? false,
      cameraEnabled: data.cameraEnabled ?? false,
    },
  });
}

export async function findActiveParticipant(
  meetingId: string,
  userId: string,
): Promise<MeetingParticipant | null> {
  return getPrismaClient().meetingParticipant.findFirst({
    where: { meetingId, userId, leftAt: null },
  });
}

export async function markParticipantLeft(
  meetingId: string,
  userId: string,
): Promise<MeetingParticipant | null> {
  const participant = await findActiveParticipant(meetingId, userId);
  if (!participant) return null;

  return getPrismaClient().meetingParticipant.update({
    where: { id: participant.id },
    data: { leftAt: new Date() },
  });
}

export async function getActiveParticipants(
  meetingId: string,
): Promise<(MeetingParticipant & {
  user: { id: string; name: string; email: string; avatarUrl: string | null };
})[]> {
  return getPrismaClient().meetingParticipant.findMany({
    where: { meetingId, leftAt: null },
    include: {
      user: {
        select: { id: true, name: true, email: true, avatarUrl: true },
      },
    },
    orderBy: { joinedAt: 'asc' },
  });
}

export async function getActiveParticipantCount(meetingId: string): Promise<number> {
  return getPrismaClient().meetingParticipant.count({
    where: { meetingId, leftAt: null },
  });
}

export async function updateParticipantMedia(
  meetingId: string,
  userId: string,
  data: { micEnabled?: boolean; cameraEnabled?: boolean },
): Promise<MeetingParticipant | null> {
  const participant = await findActiveParticipant(meetingId, userId);
  if (!participant) return null;

  return getPrismaClient().meetingParticipant.update({
    where: { id: participant.id },
    data,
  });
}

export async function updateParticipantRole(
  meetingId: string,
  userId: string,
  role: string,
): Promise<MeetingParticipant | null> {
  const participant = await findActiveParticipant(meetingId, userId);
  if (!participant) return null;

  return getPrismaClient().meetingParticipant.update({
    where: { id: participant.id },
    data: { role: role as MeetingParticipant['role'] },
  });
}

export async function markAllParticipantsLeft(meetingId: string): Promise<number> {
  const result = await getPrismaClient().meetingParticipant.updateMany({
    where: { meetingId, leftAt: null },
    data: { leftAt: new Date() },
  });
  return result.count;
}

/**
 * Find the next eligible host when current host leaves.
 * Priority: co_host first, then earliest joined participant.
 */
export async function findNextHost(
  meetingId: string,
  excludeUserId: string,
): Promise<MeetingParticipant | null> {
  // Try co-hosts first
  const coHost = await getPrismaClient().meetingParticipant.findFirst({
    where: {
      meetingId,
      leftAt: null,
      userId: { not: excludeUserId },
      role: 'co_host',
    },
    orderBy: { joinedAt: 'asc' },
  });

  if (coHost) return coHost;

  // Fall back to earliest joined participant
  return getPrismaClient().meetingParticipant.findFirst({
    where: {
      meetingId,
      leftAt: null,
      userId: { not: excludeUserId },
    },
    orderBy: { joinedAt: 'asc' },
  });
}
