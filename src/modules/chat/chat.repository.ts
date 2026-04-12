import { getPrismaClient } from '../../infrastructure/db/prisma.js';
import type { ChatMessage } from '@prisma/client';

// ---------------------------------------------------------------------------
// Chat repository
// ---------------------------------------------------------------------------

export async function createMessage(data: {
  meetingId: string;
  senderUserId: string;
  body: string;
}): Promise<
  ChatMessage & {
    sender: { id: string; name: string; avatarUrl: string | null };
  }
> {
  return getPrismaClient().chatMessage.create({
    data,
    include: {
      sender: {
        select: { id: true, name: true, avatarUrl: true },
      },
    },
  });
}

export async function getMessagesByMeeting(
  meetingId: string,
  page: number,
  limit: number,
  before?: Date,
): Promise<{
  messages: (ChatMessage & {
    sender: { id: string; name: string; avatarUrl: string | null };
  })[];
  total: number;
}> {
  const where = {
    meetingId,
    ...(before && { createdAt: { lt: before } }),
  };

  const [messages, total] = await Promise.all([
    getPrismaClient().chatMessage.findMany({
      where,
      include: {
        sender: {
          select: { id: true, name: true, avatarUrl: true },
        },
      },
      orderBy: { createdAt: 'desc' },
      skip: (page - 1) * limit,
      take: limit,
    }),
    getPrismaClient().chatMessage.count({ where }),
  ]);

  return { messages, total };
}
