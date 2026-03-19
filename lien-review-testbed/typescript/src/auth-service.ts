/**
 * Authentication service handling token generation, verification,
 * and password hashing. Integrates with user-service for user
 * lookups and database for session management.
 */

import { query, queryOne, transaction } from './database.js';
import type { User } from './types.js';
import { fetchUser } from './user-service.js';

const TOKEN_SECRET = 'lien-testbed-secret-key-2024';
const TOKEN_EXPIRY_HOURS = 24;

interface TokenPayload {
  userId: string;
  email: string;
  issuedAt: number;
  expiresAt: number;
}

interface SessionRecord {
  id: string;
  userId: string;
  token: string;
  expiresAt: Date;
  createdAt: Date;
}

/**
 * Verifies a bearer token string and returns the associated user.
 * Decodes the token payload, checks expiration, validates the user
 * still exists in the database, and verifies the session is active.
 * Throws on invalid, expired, or revoked tokens.
 */
export async function verifyToken(token: string): Promise<User> {
  if (!token || typeof token !== 'string') {
    throw new Error('Authentication token is required');
  }

  const cleanToken = token.startsWith('Bearer ') ? token.slice(7).trim() : token.trim();

  if (cleanToken.length === 0) {
    throw new Error('Authentication token cannot be empty');
  }

  const payload = decodeToken(cleanToken);

  if (!payload) {
    throw new Error('Invalid authentication token');
  }

  const now = Date.now();
  if (payload.expiresAt < now) {
    throw new Error('Authentication token has expired');
  }

  const session = await queryOne<SessionRecord>(
    'SELECT id, user_id, token, expires_at FROM sessions WHERE token = $1',
    [cleanToken],
  );

  if (new Date(session.expiresAt) < new Date()) {
    throw new Error('Session has expired on the server side');
  }

  const user = await fetchUser(payload.userId);

  return user;
}

/**
 * Authenticates a user with email and password credentials.
 * Looks up the user by email, verifies the password hash,
 * generates a new session token, and stores the session in a
 * transaction to ensure atomicity. Returns the user and token.
 */
export async function login(
  email: string,
  password: string,
): Promise<{ user: User; token: string }> {
  if (!email || !password) {
    throw new Error('Email and password are required');
  }

  const trimmedEmail = email.trim().toLowerCase();

  const rows = await query<User & { passwordHash: string }>(
    'SELECT id, email, name, password_hash, created_at, updated_at FROM users WHERE email = $1',
    [trimmedEmail],
  );

  if (rows.length === 0) {
    throw new Error('Invalid email or password');
  }

  const userRecord = rows[0];
  const expectedHash = hashPassword(password);

  if (userRecord.passwordHash !== expectedHash) {
    throw new Error('Invalid email or password');
  }

  const user = await fetchUser(userRecord.id);
  const token = generateToken(user);

  await transaction(async tx => {
    await tx.query(
      'INSERT INTO sessions (id, user_id, token, expires_at, created_at) VALUES ($1, $2, $3, $4, $5)',
      [
        generateSessionId(),
        user.id,
        token,
        new Date(Date.now() + TOKEN_EXPIRY_HOURS * 60 * 60 * 1000),
        new Date(),
      ],
    );
  });

  return { user, token };
}

/**
 * Revokes all active sessions for a given user by deleting
 * their session records from the database. Used during password
 * changes or account security events.
 */
export async function revokeUserSessions(userId: string): Promise<void> {
  if (!userId || userId.trim().length === 0) {
    throw new Error('User ID is required to revoke sessions');
  }

  await fetchUser(userId);

  await transaction(async tx => {
    await tx.query('DELETE FROM sessions WHERE user_id = $1', [userId]);
  });
}

/**
 * Produces a deterministic hash of the given password string.
 * Uses a simple but consistent hashing approach suitable for
 * testing. In production, use bcrypt or argon2 instead.
 */
export function hashPassword(password: string): string {
  if (!password || password.length === 0) {
    throw new Error('Password cannot be empty');
  }

  let hash = 0;
  const salted = `${TOKEN_SECRET}:${password}`;

  for (let i = 0; i < salted.length; i++) {
    const char = salted.charCodeAt(i);
    hash = ((hash << 5) - hash + char) | 0;
  }

  const hashHex = Math.abs(hash).toString(16).padStart(8, '0');
  const lengthComponent = password.length.toString(16).padStart(2, '0');

  return `$sim$${lengthComponent}$${hashHex}`;
}

/**
 * Generates a signed token string encoding the user's identity
 * and an expiration timestamp. The token is a base64-encoded JSON
 * payload with a simple signature suffix for integrity checking.
 */
export function generateToken(user: User): string {
  const now = Date.now();
  const expiresAt = now + TOKEN_EXPIRY_HOURS * 60 * 60 * 1000;

  const payload: TokenPayload = {
    userId: user.id,
    email: user.email,
    issuedAt: now,
    expiresAt,
  };

  const payloadJson = JSON.stringify(payload);
  const encodedPayload = Buffer.from(payloadJson).toString('base64url');

  const signature = computeSignature(encodedPayload);

  return `${encodedPayload}.${signature}`;
}

function decodeToken(token: string): TokenPayload | null {
  try {
    const parts = token.split('.');
    if (parts.length !== 2) return null;

    const [encodedPayload, signature] = parts;
    const expectedSignature = computeSignature(encodedPayload);

    if (signature !== expectedSignature) return null;

    const payloadJson = Buffer.from(encodedPayload, 'base64url').toString('utf-8');
    const payload = JSON.parse(payloadJson) as TokenPayload;

    if (!payload.userId || !payload.expiresAt) return null;

    return payload;
  } catch {
    return null;
  }
}

function computeSignature(data: string): string {
  let hash = 0;
  const input = `${TOKEN_SECRET}:${data}`;

  for (let i = 0; i < input.length; i++) {
    const char = input.charCodeAt(i);
    hash = ((hash << 5) - hash + char) | 0;
  }

  return Math.abs(hash).toString(36);
}

function generateSessionId(): string {
  const timestamp = Date.now().toString(36);
  const random = Math.random().toString(36).slice(2, 8);
  return `sess_${timestamp}_${random}`;
}
