import bcrypt from 'bcrypt';
import jwt from 'jsonwebtoken';
import crypto from 'crypto';
import { config } from '../../config/index.js';
import { ErrorCode, Limits, AuditEvent } from '../../config/constants.js';
import { AppError, invalidCredentialsError, refreshTokenInvalidError } from '../../errors/app-error.js';
import * as authRepo from './auth.repository.js';
import { auditQueue } from '../../infrastructure/queue/queue.js';
import { authAttemptsTotal } from '../../logging/metrics.js';
import { logger } from '../../logging/logger.js';
import type { ServiceResult } from '../../common/types.js';
import { success, failure } from '../../common/types.js';

const log = logger.child({ module: 'auth.service' });

const SALT_ROUNDS = 12;

// ---------------------------------------------------------------------------
// Token generation
// ---------------------------------------------------------------------------

function parseExpiryToSeconds(expiry: string): number {
  const match = expiry.match(/^(\d+)([smhd])$/);
  if (!match) return 900; // 15 minutes default
  const [, value, unit] = match;
  const multipliers: Record<string, number> = { s: 1, m: 60, h: 3600, d: 86400 };
  return parseInt(value!, 10) * (multipliers[unit!] ?? 60);
}

function generateAccessToken(userId: string, email: string, sessionId: string): string {
  return jwt.sign(
    { userId, email, sessionId },
    config.jwt.accessSecret,
    { expiresIn: parseExpiryToSeconds(config.jwt.accessExpiry), issuer: 'video-calling-backend' },
  );
}

function generateRefreshToken(): string {
  return crypto.randomBytes(64).toString('hex');
}

function hashToken(token: string): string {
  return crypto.createHash('sha256').update(token).digest('hex');
}

function getRefreshExpiryDate(): Date {
  const match = config.jwt.refreshExpiry.match(/^(\d+)([smhd])$/);
  if (!match) {
    return new Date(Date.now() + 7 * 24 * 60 * 60 * 1000); // 7 days default
  }
  const [, value, unit] = match;
  const multipliers: Record<string, number> = {
    s: 1000,
    m: 60 * 1000,
    h: 60 * 60 * 1000,
    d: 24 * 60 * 60 * 1000,
  };
  return new Date(Date.now() + parseInt(value!, 10) * (multipliers[unit!] ?? multipliers['d']!));
}

// ---------------------------------------------------------------------------
// Register
// ---------------------------------------------------------------------------

interface RegisterResult {
  user: { id: string; name: string; email: string };
  accessToken: string;
  refreshToken: string;
}

export async function register(
  name: string,
  email: string,
  password: string,
  meta?: { ipAddress?: string; userAgent?: string; deviceId?: string },
): Promise<ServiceResult<RegisterResult>> {
  // Check if user already exists
  const existing = await authRepo.findUserByEmail(email);
  if (existing) {
    return failure(ErrorCode.USER_ALREADY_EXISTS, 'An account with this email already exists.', 409);
  }

  // Hash password
  const hashedPassword = await bcrypt.hash(password, SALT_ROUNDS);

  // Create user
  const user = await authRepo.createUser({ name, email, password: hashedPassword });

  // Create session
  const refreshToken = generateRefreshToken();
  const refreshTokenHash = hashToken(refreshToken);
  const expiresAt = getRefreshExpiryDate();

  const session = await authRepo.createSession({
    userId: user.id,
    refreshTokenHash,
    deviceId: meta?.deviceId,
    userAgent: meta?.userAgent,
    ipAddress: meta?.ipAddress,
    expiresAt,
  });

  // Generate access token
  const accessToken = generateAccessToken(user.id, user.email, session.id);

  // Audit log
  await auditQueue.add('user-register', {
    actorUserId: user.id,
    meetingId: null,
    eventType: AuditEvent.USER_LOGIN,
    payload: { action: 'register' },
    ipAddress: meta?.ipAddress,
    userAgent: meta?.userAgent,
    timestamp: new Date().toISOString(),
  });

  log.info({ userId: user.id }, 'User registered');

  return success({
    user: { id: user.id, name: user.name, email: user.email },
    accessToken,
    refreshToken,
  });
}

// ---------------------------------------------------------------------------
// Login
// ---------------------------------------------------------------------------

interface LoginResult {
  user: { id: string; name: string; email: string; avatarUrl: string | null };
  accessToken: string;
  refreshToken: string;
}

export async function login(
  email: string,
  password: string,
  meta?: { ipAddress?: string; userAgent?: string; deviceId?: string },
): Promise<ServiceResult<LoginResult>> {
  // Find user
  const user = await authRepo.findUserByEmail(email);
  if (!user) {
    authAttemptsTotal.inc({ type: 'login', status: 'failure' });
    return failure(ErrorCode.INVALID_CREDENTIALS, 'Invalid email or password.', 401);
  }

  // Check account status
  if (user.status !== 'active') {
    authAttemptsTotal.inc({ type: 'login', status: 'failure' });
    return failure(ErrorCode.USER_DISABLED, 'This account has been disabled.', 403);
  }

  // Verify password
  const isValid = await bcrypt.compare(password, user.password);
  if (!isValid) {
    authAttemptsTotal.inc({ type: 'login', status: 'failure' });
    return failure(ErrorCode.INVALID_CREDENTIALS, 'Invalid email or password.', 401);
  }

  // Enforce max sessions per user
  const sessionCount = await authRepo.countUserSessions(user.id);
  if (sessionCount >= Limits.MAX_SESSIONS_PER_USER) {
    // Remove oldest session
    const oldest = await authRepo.getOldestUserSession(user.id);
    if (oldest) {
      await authRepo.deleteSession(oldest.id);
      log.info({ userId: user.id, sessionId: oldest.id }, 'Oldest session evicted');
    }
  }

  // Create new session
  const refreshToken = generateRefreshToken();
  const refreshTokenHash = hashToken(refreshToken);
  const expiresAt = getRefreshExpiryDate();

  const session = await authRepo.createSession({
    userId: user.id,
    refreshTokenHash,
    deviceId: meta?.deviceId,
    userAgent: meta?.userAgent,
    ipAddress: meta?.ipAddress,
    expiresAt,
  });

  const accessToken = generateAccessToken(user.id, user.email, session.id);

  authAttemptsTotal.inc({ type: 'login', status: 'success' });

  // Audit log
  await auditQueue.add('user-login', {
    actorUserId: user.id,
    meetingId: null,
    eventType: AuditEvent.USER_LOGIN,
    payload: { action: 'login' },
    ipAddress: meta?.ipAddress,
    userAgent: meta?.userAgent,
    timestamp: new Date().toISOString(),
  });

  log.info({ userId: user.id }, 'User logged in');

  return success({
    user: {
      id: user.id,
      name: user.name,
      email: user.email,
      avatarUrl: user.avatarUrl,
    },
    accessToken,
    refreshToken,
  });
}

// ---------------------------------------------------------------------------
// Refresh token
// ---------------------------------------------------------------------------

interface RefreshResult {
  accessToken: string;
  refreshToken: string;
}

export async function refreshAccessToken(
  refreshToken: string,
  meta?: { ipAddress?: string; userAgent?: string },
): Promise<ServiceResult<RefreshResult>> {
  const tokenHash = hashToken(refreshToken);

  // Find session by token hash
  const session = await authRepo.findSessionByTokenHash(tokenHash);
  if (!session) {
    authAttemptsTotal.inc({ type: 'refresh', status: 'failure' });
    return failure(ErrorCode.REFRESH_TOKEN_INVALID, 'Refresh token is invalid or has been revoked.', 401);
  }

  // Check expiry
  if (session.expiresAt < new Date()) {
    await authRepo.deleteSession(session.id);
    authAttemptsTotal.inc({ type: 'refresh', status: 'failure' });
    return failure(ErrorCode.REFRESH_TOKEN_EXPIRED, 'Refresh token has expired.', 401);
  }

  // Find user
  const user = await authRepo.findUserById(session.userId);
  if (!user || user.status !== 'active') {
    await authRepo.deleteSession(session.id);
    return failure(ErrorCode.USER_DISABLED, 'Account is no longer active.', 403);
  }

  // Rotate refresh token
  const newRefreshToken = generateRefreshToken();
  const newRefreshTokenHash = hashToken(newRefreshToken);
  const newExpiresAt = getRefreshExpiryDate();

  await authRepo.rotateSessionToken(session.id, newRefreshTokenHash, newExpiresAt);

  // Generate new access token
  const accessToken = generateAccessToken(user.id, user.email, session.id);

  authAttemptsTotal.inc({ type: 'refresh', status: 'success' });

  // Audit log
  await auditQueue.add('token-refresh', {
    actorUserId: user.id,
    meetingId: null,
    eventType: AuditEvent.TOKEN_REFRESH,
    payload: { sessionId: session.id },
    ipAddress: meta?.ipAddress,
    userAgent: meta?.userAgent,
    timestamp: new Date().toISOString(),
  });

  return success({ accessToken, refreshToken: newRefreshToken });
}

// ---------------------------------------------------------------------------
// Logout
// ---------------------------------------------------------------------------

export async function logout(
  sessionId: string,
  userId: string,
  allDevices: boolean = false,
  meta?: { ipAddress?: string; userAgent?: string },
): Promise<ServiceResult<{ loggedOut: boolean }>> {
  if (allDevices) {
    await authRepo.deleteAllUserSessions(userId);
  } else {
    const session = await authRepo.findSessionById(sessionId);
    if (session && session.userId === userId) {
      await authRepo.deleteSession(sessionId);
    }
  }

  // Audit log
  await auditQueue.add('user-logout', {
    actorUserId: userId,
    meetingId: null,
    eventType: AuditEvent.USER_LOGOUT,
    payload: { allDevices },
    ipAddress: meta?.ipAddress,
    userAgent: meta?.userAgent,
    timestamp: new Date().toISOString(),
  });

  log.info({ userId, allDevices }, 'User logged out');

  return success({ loggedOut: true });
}
