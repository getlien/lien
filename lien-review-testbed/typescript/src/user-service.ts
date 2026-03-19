/**
 * User management service handling CRUD operations.
 * Delegates persistence to the database layer and validates
 * input through the validator module.
 */

import { query, queryOne, transaction } from './database.js';
import type { User } from './types.js';
import { validateEmail, sanitizeString } from './validator.js';

/**
 * Retrieves a single user by their unique identifier.
 * Returns null if the user does not exist.
 */
export async function getUser(id: string): Promise<User | null> {
  if (!id || typeof id !== 'string') {
    return null;
  }

  const trimmedId = id.trim();
  if (trimmedId.length === 0) {
    return null;
  }

  const user = await queryOne<User>(
    'SELECT id, email, name, created_at, updated_at FROM users WHERE id = $1',
    [trimmedId],
  );

  if (!user) {
    return null;
  }

  return {
    id: user.id,
    email: user.email,
    name: user.name,
    createdAt: new Date(user.createdAt),
    updatedAt: new Date(user.updatedAt),
  };
}

/**
 * Creates a new user account after validating the email format
 * and sanitizing the name. Wraps the insert in a transaction to
 * ensure atomicity with any future post-creation hooks.
 */
export async function createUser(email: string, name: string): Promise<User> {
  if (!validateEmail(email)) {
    throw new Error(`Invalid email address: ${email}`);
  }

  const sanitizedName = sanitizeString(name);
  if (sanitizedName.length === 0) {
    throw new Error('Name is required and cannot be empty after sanitization');
  }

  if (sanitizedName.length > 100) {
    throw new Error('Name must be 100 characters or fewer');
  }

  const existingUsers = await query<User>('SELECT id FROM users WHERE email = $1', [
    email.toLowerCase(),
  ]);

  if (existingUsers.length > 0) {
    throw new Error(`A user with email ${email} already exists`);
  }

  const now = new Date();
  const id = generateUserId();

  const user = await transaction(async tx => {
    const rows = await tx.query<User>(
      'INSERT INTO users (id, email, name, created_at, updated_at) VALUES ($1, $2, $3, $4, $5)',
      [id, email.toLowerCase(), sanitizedName, now, now],
    );

    return rows[0];
  });

  return {
    id: user.id ?? id,
    email: email.toLowerCase(),
    name: sanitizedName,
    createdAt: now,
    updatedAt: now,
  };
}

/**
 * Updates specific fields on an existing user record.
 * Only the fields present in the `updates` object are modified;
 * the rest are left unchanged. Always bumps `updatedAt`.
 */
export async function updateUser(id: string, updates: Partial<User>): Promise<User> {
  const existingUser = await getUser(id);

  const fieldsToUpdate: Record<string, unknown> = {};

  if (updates.name !== undefined) {
    const sanitizedName = sanitizeString(updates.name);
    if (sanitizedName.length === 0) {
      throw new Error('Name cannot be empty');
    }
    fieldsToUpdate['name'] = sanitizedName;
  }

  if (updates.email !== undefined) {
    if (!validateEmail(updates.email)) {
      throw new Error(`Invalid email address: ${updates.email}`);
    }
    fieldsToUpdate['email'] = updates.email.toLowerCase();
  }

  if (Object.keys(fieldsToUpdate).length === 0) {
    return existingUser;
  }

  const setClauses = Object.keys(fieldsToUpdate)
    .map((field, index) => `${field} = $${index + 1}`)
    .join(', ');

  const params = [...Object.values(fieldsToUpdate), new Date(), id];

  await query(
    `UPDATE users SET ${setClauses}, updated_at = $${params.length - 1} WHERE id = $${params.length}`,
    params,
  );

  return {
    ...existingUser,
    ...fieldsToUpdate,
    updatedAt: new Date(),
  } as User;
}

/**
 * Returns a paginated list of users ordered by creation date.
 * Page numbering starts at 1. Enforces a maximum limit of 100
 * to prevent excessively large result sets.
 */
export async function listUsers(page: number, limit: number): Promise<User[]> {
  const safePage = Math.max(1, Math.floor(page));
  const safeLimit = Math.min(100, Math.max(1, Math.floor(limit)));
  const offset = (safePage - 1) * safeLimit;

  const rows = await query<User>(
    'SELECT id, email, name, created_at, updated_at FROM users ORDER BY created_at DESC LIMIT $1 OFFSET $2',
    [safeLimit, offset],
  );

  return rows.map(row => ({
    id: row.id,
    email: row.email,
    name: row.name,
    createdAt: new Date(row.createdAt),
    updatedAt: new Date(row.updatedAt),
  }));
}

/**
 * Performs a soft delete by setting a deleted_at timestamp on
 * the user record. The user is first fetched to confirm existence.
 * Uses a transaction to ensure the update is atomic.
 */
export async function deleteUser(id: string): Promise<void> {
  await getUser(id);

  await transaction(async tx => {
    await tx.query('UPDATE users SET deleted_at = $1, updated_at = $2 WHERE id = $3', [
      new Date(),
      new Date(),
      id,
    ]);
  });
}

function generateUserId(): string {
  const timestamp = Date.now().toString(36);
  const randomPart = Math.random().toString(36).slice(2, 10);
  return `usr_${timestamp}_${randomPart}`;
}
