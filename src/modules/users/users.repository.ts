import { getPrismaClient } from '../../infrastructure/db/prisma.js';
import type { User } from '@prisma/client';

// ---------------------------------------------------------------------------
// Users repository
// ---------------------------------------------------------------------------

/**
 * Find user by ID, excluding password field.
 */
export async function findUserById(id: string): Promise<Omit<User, 'password'> | null> {
  return getPrismaClient().user.findUnique({
    where: { id },
    select: {
      id: true,
      name: true,
      email: true,
      avatarUrl: true,
      status: true,
      createdAt: true,
      updatedAt: true,
    },
  }) as Promise<Omit<User, 'password'> | null>;
}

/**
 * Find user by email, excluding password field.
 */
export async function findUserByEmail(
  email: string,
): Promise<Omit<User, 'password'> | null> {
  return getPrismaClient().user.findUnique({
    where: { email },
    select: {
      id: true,
      name: true,
      email: true,
      avatarUrl: true,
      status: true,
      createdAt: true,
      updatedAt: true,
    },
  }) as Promise<Omit<User, 'password'> | null>;
}

/**
 * Update user profile.
 */
export async function updateUserProfile(
  id: string,
  data: { name?: string; avatarUrl?: string },
): Promise<Omit<User, 'password'> | null> {
  return getPrismaClient().user.update({
    where: { id },
    data,
    select: {
      id: true,
      name: true,
      email: true,
      avatarUrl: true,
      status: true,
      createdAt: true,
      updatedAt: true,
    },
  }) as Promise<Omit<User, 'password'> | null>;
}
