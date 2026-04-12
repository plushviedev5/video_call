import { ErrorCode } from '../../config/constants.js';
import * as usersRepo from './users.repository.js';
import type { ServiceResult } from '../../common/types.js';
import { success, failure } from '../../common/types.js';
import { logger } from '../../logging/logger.js';

const log = logger.child({ module: 'users.service' });

// ---------------------------------------------------------------------------
// User profile types
// ---------------------------------------------------------------------------

export interface UserProfile {
  id: string;
  name: string;
  email: string;
  avatarUrl: string | null;
  status: string;
  createdAt: Date;
}

// ---------------------------------------------------------------------------
// Get authenticated user profile
// ---------------------------------------------------------------------------

export async function getMyProfile(userId: string): Promise<ServiceResult<UserProfile>> {
  const user = await usersRepo.findUserById(userId);

  if (!user) {
    return failure(ErrorCode.USER_NOT_FOUND, 'User not found.', 404);
  }

  if (user.status !== 'active') {
    return failure(ErrorCode.USER_DISABLED, 'This account has been disabled.', 403);
  }

  return success({
    id: user.id,
    name: user.name,
    email: user.email,
    avatarUrl: user.avatarUrl,
    status: user.status,
    createdAt: user.createdAt,
  });
}

// ---------------------------------------------------------------------------
// Update profile
// ---------------------------------------------------------------------------

export async function updateProfile(
  userId: string,
  data: { name?: string; avatarUrl?: string },
): Promise<ServiceResult<UserProfile>> {
  const user = await usersRepo.findUserById(userId);
  if (!user) {
    return failure(ErrorCode.USER_NOT_FOUND, 'User not found.', 404);
  }

  const updated = await usersRepo.updateUserProfile(userId, data);
  if (!updated) {
    return failure(ErrorCode.INTERNAL_ERROR, 'Failed to update profile.', 500);
  }

  log.info({ userId }, 'User profile updated');

  return success({
    id: updated.id,
    name: updated.name,
    email: updated.email,
    avatarUrl: updated.avatarUrl,
    status: updated.status,
    createdAt: updated.createdAt,
  });
}
