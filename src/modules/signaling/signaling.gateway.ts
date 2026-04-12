import { Server as SocketIOServer, type Socket } from 'socket.io';
import type { Server as HTTPServer } from 'http';
import { authenticateSocket } from '../../middleware/auth.middleware.js';
import { SocketEvent, ErrorCode } from '../../config/constants.js';
import * as signalingService from './signaling.service.js';
import * as chatService from '../chat/chat.service.js';
import * as participantsService from '../participants/participants.service.js';
import * as meetingsService from '../meetings/meetings.service.js';
import {
  addUserSocket,
  removeUserSocket,
} from '../../infrastructure/redis/presence.js';
import { checkSocketRateLimit } from '../../middleware/rate-limit.middleware.js';
import {
  socketConnectionsGauge,
  socketEventsTotal,
  chatMessageLatency,
  chatMessagesTotal,
} from '../../logging/metrics.js';
import {
  socketMeetingJoinSchema,
  socketMeetingLeaveSchema,
  socketWebRTCOfferSchema,
  socketWebRTCAnswerSchema,
  socketWebRTCIceCandidateSchema,
  socketChatSendSchema,
  socketMediaUpdateSchema,
} from '../../validation/schemas.js';
import { logger } from '../../logging/logger.js';
import { config } from '../../config/index.js';
import type { AuthPayload, SocketAck } from '../../common/types.js';
import * as usersRepo from '../users/users.repository.js';

const log = logger.child({ module: 'signaling.gateway' });

// ---------------------------------------------------------------------------
// Socket user context
// ---------------------------------------------------------------------------

interface AuthenticatedSocket extends Socket {
  data: {
    user: AuthPayload;
    currentMeetingId?: string;
  };
}

// ---------------------------------------------------------------------------
// Helper: create ack responses
// ---------------------------------------------------------------------------

function ackSuccess<T>(data?: T): SocketAck<T> {
  return { success: true, data };
}

function ackError(code: string, message: string): SocketAck {
  return { success: false, error: { code, message } };
}

// ---------------------------------------------------------------------------
// Initialize Socket.IO gateway
// ---------------------------------------------------------------------------

export function initializeSignalingGateway(httpServer: HTTPServer): SocketIOServer {
  const io = new SocketIOServer(httpServer, {
    cors: {
      origin: config.cors.origin,
      credentials: true,
    },
    pingInterval: 25000,
    pingTimeout: 20000,
    transports: ['websocket', 'polling'],
    connectionStateRecovery: {
      maxDisconnectionDuration: 2 * 60 * 1000, // 2 minutes
    },
  });

  // -----------------------------------------------------------------------
  // Authentication middleware
  // -----------------------------------------------------------------------
  io.use((socket, next) => {
    try {
      const handshake = socket.handshake as unknown as {
        auth?: { token?: string };
        headers?: Record<string, string>;
      };
      const user = authenticateSocket(handshake);
      (socket as AuthenticatedSocket).data = { user };
      next();
    } catch (error) {
      log.warn({ socketId: socket.id }, 'Socket auth rejected');
      next(new Error('Authentication failed'));
    }
  });

  // -----------------------------------------------------------------------
  // Connection handler
  // -----------------------------------------------------------------------
  io.on('connection', (rawSocket: Socket) => {
    const socket = rawSocket as AuthenticatedSocket;
    const { user } = socket.data;

    socketConnectionsGauge.inc();
    log.info({ socketId: socket.id, userId: user.userId }, 'Socket connected');

    // Track socket in Redis
    addUserSocket(user.userId, socket.id).catch((err) =>
      log.error({ error: err }, 'Failed to track socket'),
    );

    // -------------------------------------------------------------------
    // connection:init — client acknowledges connection
    // -------------------------------------------------------------------
    socket.on(SocketEvent.CONNECTION_INIT, (callback?: (ack: SocketAck) => void) => {
      socketEventsTotal.inc({ event: 'connection:init', status: 'success' });
      callback?.(ackSuccess({ userId: user.userId }));
    });

    // -------------------------------------------------------------------
    // meeting:join — join a meeting room
    // -------------------------------------------------------------------
    socket.on(
      SocketEvent.MEETING_JOIN,
      async (payload: unknown, callback?: (ack: SocketAck) => void) => {
        try {
          const parsed = socketMeetingJoinSchema.parse(payload);
          const { meetingId } = parsed;

          // Rate limit
          const allowed = await checkSocketRateLimit('socket_join', user.userId, 10, 60);
          if (!allowed) {
            callback?.(ackError(ErrorCode.RATE_LIMIT_EXCEEDED, 'Too many join attempts.'));
            return;
          }

          // Get user info for presence
          const userInfo = await usersRepo.findUserById(user.userId);
          if (!userInfo) {
            callback?.(ackError(ErrorCode.USER_NOT_FOUND, 'User not found.'));
            return;
          }

          // Join via REST service first (DB-level join)
          const joinResult = await meetingsService.joinMeeting(meetingId, user.userId);
          if (!joinResult.success) {
            callback?.(ackError(joinResult.error.code, joinResult.error.message));
            socketEventsTotal.inc({ event: 'meeting:join', status: 'failure' });
            return;
          }

          // Join signaling room (Redis presence)
          const roomResult = await signalingService.joinRoom(
            meetingId,
            user.userId,
            socket.id,
            userInfo.name,
            joinResult.data.role,
          );

          if (!roomResult.success) {
            callback?.(ackError(roomResult.error.code, roomResult.error.message));
            return;
          }

          // Join Socket.IO room
          await socket.join(meetingId);
          socket.data.currentMeetingId = meetingId;

          // Acknowledge to sender
          callback?.(
            ackSuccess({
              meetingId,
              participants: roomResult.data.participants,
              role: joinResult.data.role,
            }),
          );

          // Broadcast to room
          socket.to(meetingId).emit(SocketEvent.PARTICIPANT_JOINED, {
            userId: user.userId,
            name: userInfo.name,
            role: joinResult.data.role,
            socketId: socket.id,
          });

          socketEventsTotal.inc({ event: 'meeting:join', status: 'success' });
          log.info({ meetingId, userId: user.userId }, 'Socket joined meeting room');
        } catch (error) {
          log.error({ error, userId: user.userId }, 'meeting:join error');
          callback?.(ackError(ErrorCode.INTERNAL_ERROR, 'Failed to join meeting.'));
          socketEventsTotal.inc({ event: 'meeting:join', status: 'failure' });
        }
      },
    );

    // -------------------------------------------------------------------
    // meeting:leave — leave a meeting room
    // -------------------------------------------------------------------
    socket.on(
      SocketEvent.MEETING_LEAVE,
      async (payload: unknown, callback?: (ack: SocketAck) => void) => {
        try {
          const parsed = socketMeetingLeaveSchema.parse(payload);
          const { meetingId } = parsed;

          await handleLeaveRoom(socket, meetingId);

          callback?.(ackSuccess({ left: true }));
          socketEventsTotal.inc({ event: 'meeting:leave', status: 'success' });
        } catch (error) {
          log.error({ error, userId: user.userId }, 'meeting:leave error');
          callback?.(ackError(ErrorCode.INTERNAL_ERROR, 'Failed to leave meeting.'));
          socketEventsTotal.inc({ event: 'meeting:leave', status: 'failure' });
        }
      },
    );

    // -------------------------------------------------------------------
    // webrtc:offer — relay SDP offer to target user
    // -------------------------------------------------------------------
    socket.on(
      SocketEvent.WEBRTC_OFFER,
      async (payload: unknown, callback?: (ack: SocketAck) => void) => {
        try {
          const parsed = socketWebRTCOfferSchema.parse(payload);

          // Rate limit signaling
          const allowed = await checkSocketRateLimit('signaling', user.userId, 200, 10);
          if (!allowed) {
            callback?.(ackError(ErrorCode.RATE_LIMIT_EXCEEDED, 'Signaling rate limit exceeded.'));
            return;
          }

          // Validate and deduplicate
          const result = await signalingService.validateSignalingMessage(
            parsed.meetingId,
            user.userId,
            parsed.targetUserId,
            parsed.messageId,
          );

          if (!result.success) {
            callback?.(ackError(result.error.code, result.error.message));
            return;
          }

          // Relay offer to target
          io.to(result.data.targetSocketId).emit(SocketEvent.WEBRTC_OFFER, {
            meetingId: parsed.meetingId,
            senderUserId: user.userId,
            sdp: parsed.sdp,
            messageId: parsed.messageId,
          });

          callback?.(ackSuccess());
          socketEventsTotal.inc({ event: 'webrtc:offer', status: 'success' });
        } catch (error) {
          log.error({ error, userId: user.userId }, 'webrtc:offer error');
          callback?.(ackError(ErrorCode.INTERNAL_ERROR, 'Failed to relay offer.'));
          socketEventsTotal.inc({ event: 'webrtc:offer', status: 'failure' });
        }
      },
    );

    // -------------------------------------------------------------------
    // webrtc:answer — relay SDP answer to target user
    // -------------------------------------------------------------------
    socket.on(
      SocketEvent.WEBRTC_ANSWER,
      async (payload: unknown, callback?: (ack: SocketAck) => void) => {
        try {
          const parsed = socketWebRTCAnswerSchema.parse(payload);

          const allowed = await checkSocketRateLimit('signaling', user.userId, 200, 10);
          if (!allowed) {
            callback?.(ackError(ErrorCode.RATE_LIMIT_EXCEEDED, 'Signaling rate limit exceeded.'));
            return;
          }

          const result = await signalingService.validateSignalingMessage(
            parsed.meetingId,
            user.userId,
            parsed.targetUserId,
            parsed.messageId,
          );

          if (!result.success) {
            callback?.(ackError(result.error.code, result.error.message));
            return;
          }

          io.to(result.data.targetSocketId).emit(SocketEvent.WEBRTC_ANSWER, {
            meetingId: parsed.meetingId,
            senderUserId: user.userId,
            sdp: parsed.sdp,
            messageId: parsed.messageId,
          });

          callback?.(ackSuccess());
          socketEventsTotal.inc({ event: 'webrtc:answer', status: 'success' });
        } catch (error) {
          log.error({ error, userId: user.userId }, 'webrtc:answer error');
          callback?.(ackError(ErrorCode.INTERNAL_ERROR, 'Failed to relay answer.'));
          socketEventsTotal.inc({ event: 'webrtc:answer', status: 'failure' });
        }
      },
    );

    // -------------------------------------------------------------------
    // webrtc:ice-candidate — relay ICE candidate to target user
    // -------------------------------------------------------------------
    socket.on(
      SocketEvent.WEBRTC_ICE_CANDIDATE,
      async (payload: unknown, callback?: (ack: SocketAck) => void) => {
        try {
          const parsed = socketWebRTCIceCandidateSchema.parse(payload);

          const allowed = await checkSocketRateLimit('signaling', user.userId, 200, 10);
          if (!allowed) {
            callback?.(ackError(ErrorCode.RATE_LIMIT_EXCEEDED, 'Signaling rate limit exceeded.'));
            return;
          }

          const result = await signalingService.validateSignalingMessage(
            parsed.meetingId,
            user.userId,
            parsed.targetUserId,
            parsed.messageId,
          );

          if (!result.success) {
            callback?.(ackError(result.error.code, result.error.message));
            return;
          }

          io.to(result.data.targetSocketId).emit(SocketEvent.WEBRTC_ICE_CANDIDATE, {
            meetingId: parsed.meetingId,
            senderUserId: user.userId,
            candidate: parsed.candidate,
            sdpMid: parsed.sdpMid,
            sdpMLineIndex: parsed.sdpMLineIndex,
            messageId: parsed.messageId,
          });

          callback?.(ackSuccess());
          socketEventsTotal.inc({ event: 'webrtc:ice-candidate', status: 'success' });
        } catch (error) {
          log.error({ error, userId: user.userId }, 'webrtc:ice-candidate error');
          callback?.(ackError(ErrorCode.INTERNAL_ERROR, 'Failed to relay ICE candidate.'));
          socketEventsTotal.inc({ event: 'webrtc:ice-candidate', status: 'failure' });
        }
      },
    );

    // -------------------------------------------------------------------
    // chat:send — send a chat message
    // -------------------------------------------------------------------
    socket.on(
      SocketEvent.CHAT_SEND,
      async (payload: unknown, callback?: (ack: SocketAck) => void) => {
        const startTime = Date.now();
        try {
          const parsed = socketChatSendSchema.parse(payload);

          // Rate limit
          const allowed = await checkSocketRateLimit('chat', user.userId, 60, 60);
          if (!allowed) {
            callback?.(ackError(ErrorCode.RATE_LIMIT_EXCEEDED, 'Chat rate limit exceeded.'));
            return;
          }

          // Persist message first
          const result = await chatService.sendMessage(
            parsed.meetingId,
            user.userId,
            parsed.body,
          );

          if (!result.success) {
            callback?.(ackError(result.error.code, result.error.message));
            return;
          }

          // Broadcast to room (including sender for confirmation)
          io.to(parsed.meetingId).emit(SocketEvent.CHAT_MESSAGE, result.data);

          callback?.(ackSuccess(result.data));

          // Record latency
          const latency = (Date.now() - startTime) / 1000;
          chatMessageLatency.observe(latency);
          chatMessagesTotal.inc();
          socketEventsTotal.inc({ event: 'chat:send', status: 'success' });
        } catch (error) {
          log.error({ error, userId: user.userId }, 'chat:send error');
          callback?.(ackError(ErrorCode.INTERNAL_ERROR, 'Failed to send message.'));
          socketEventsTotal.inc({ event: 'chat:send', status: 'failure' });
        }
      },
    );

    // -------------------------------------------------------------------
    // participant:update-media — update mic/camera flags
    // -------------------------------------------------------------------
    socket.on(
      SocketEvent.PARTICIPANT_UPDATE_MEDIA,
      async (payload: unknown, callback?: (ack: SocketAck) => void) => {
        try {
          const parsed = socketMediaUpdateSchema.parse(payload);

          // Update in DB
          await participantsService.updateMedia(
            parsed.meetingId,
            user.userId,
            {
              micEnabled: parsed.micEnabled,
              cameraEnabled: parsed.cameraEnabled,
            },
          );

          // Update in Redis presence
          await signalingService.updateMediaPresence(parsed.meetingId, user.userId, {
            micEnabled: parsed.micEnabled,
            cameraEnabled: parsed.cameraEnabled,
          });

          // Broadcast to room
          socket.to(parsed.meetingId).emit(SocketEvent.PARTICIPANT_MEDIA_UPDATED, {
            userId: user.userId,
            micEnabled: parsed.micEnabled,
            cameraEnabled: parsed.cameraEnabled,
          });

          callback?.(ackSuccess());
          socketEventsTotal.inc({ event: 'participant:update-media', status: 'success' });
        } catch (error) {
          log.error({ error, userId: user.userId }, 'participant:update-media error');
          callback?.(ackError(ErrorCode.INTERNAL_ERROR, 'Failed to update media.'));
          socketEventsTotal.inc({ event: 'participant:update-media', status: 'failure' });
        }
      },
    );

    // -------------------------------------------------------------------
    // disconnect — cleanup
    // -------------------------------------------------------------------
    socket.on('disconnect', async (reason) => {
      socketConnectionsGauge.dec();
      log.info({ socketId: socket.id, userId: user.userId, reason }, 'Socket disconnected');

      // Remove socket tracking
      await removeUserSocket(user.userId, socket.id).catch((err) =>
        log.error({ error: err }, 'Failed to remove user socket'),
      );

      // If user was in a meeting, handle leave
      const meetingId = socket.data.currentMeetingId;
      if (meetingId) {
        await handleLeaveRoom(socket, meetingId).catch((err) =>
          log.error({ error: err, meetingId }, 'Failed to handle disconnect leave'),
        );
      }
    });
  });

  log.info('Signaling gateway initialized');
  return io;
}

// ---------------------------------------------------------------------------
// Helper: handle leaving a room
// ---------------------------------------------------------------------------

async function handleLeaveRoom(
  socket: AuthenticatedSocket,
  meetingId: string,
): Promise<void> {
  const userId = socket.data.user.userId;

  // Leave signaling room (Redis)
  await signalingService.leaveRoom(meetingId, userId);

  // Leave DB meeting
  const leaveResult = await meetingsService.leaveMeeting(meetingId, userId);

  // Leave Socket.IO room
  socket.leave(meetingId);
  socket.data.currentMeetingId = undefined;

  // Broadcast departure
  socket.to(meetingId).emit(SocketEvent.PARTICIPANT_LEFT, {
    userId,
  });

  // If meeting ended, notify everyone
  if (leaveResult.success && leaveResult.data.meetingEnded) {
    socket.to(meetingId).emit(SocketEvent.MEETING_ENDED, {
      meetingId,
      reason: 'all_left',
    });
  }

  // If host transferred, notify
  if (leaveResult.success && leaveResult.data.newHostUserId) {
    socket.to(meetingId).emit('meeting:host-changed', {
      meetingId,
      newHostUserId: leaveResult.data.newHostUserId,
    });
  }

  log.info({ meetingId, userId }, 'User left room via socket');
}
