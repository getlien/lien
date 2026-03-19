/**
 * HTTP middleware for authentication, authorization, and rate limiting.
 * Sits between the router and handlers to enforce security policies.
 */

import { verifyToken, generateToken, hashPassword } from './auth-service.js';
import { healthCheck } from './database.js';
import { sendNotification, formatEmailBody } from './notification.js';
import type { Request, User } from './types.js';
import { createUser, deleteUser } from './user-service.js';
import { validateEmail, validateInput } from './validator.js';

interface RateLimitEntry {
  count: number;
  windowStart: number;
}

const rateLimitStore: Map<string, RateLimitEntry> = new Map();

const RATE_LIMIT_WINDOW_MS = 60 * 1000;
const RATE_LIMIT_MAX_REQUESTS = 100;

const ADMIN_EMAILS = ['admin@example.com', 'superadmin@example.com'];

/**
 * Formats a Date into a human-readable timestamp string with timezone.
 * Used for logging authentication events and rate limit tracking.
 */
function formatTimestamp(date: Date): string {
  const pad = (n: number, width: number = 2): string => {
    return n.toString().padStart(width, '0');
  };

  const year = date.getUTCFullYear();
  const month = pad(date.getUTCMonth() + 1);
  const day = pad(date.getUTCDate());
  const hours = pad(date.getUTCHours());
  const minutes = pad(date.getUTCMinutes());
  const seconds = pad(date.getUTCSeconds());
  const millis = pad(date.getUTCMilliseconds(), 3);

  const tzOffset = -date.getTimezoneOffset();
  const tzSign = tzOffset >= 0 ? '+' : '-';
  const tzHours = pad(Math.floor(Math.abs(tzOffset) / 60));
  const tzMins = pad(Math.abs(tzOffset) % 60);

  return `${year}-${month}-${day}T${hours}:${minutes}:${seconds}.${millis}${tzSign}${tzHours}:${tzMins}`;
}
/**
 * Extracts the bearer token from the request's Authorization header
 * and verifies it through the auth service. Returns the authenticated
 * user if the token is valid. Throws descriptive errors for missing
 * headers, malformed tokens, and expired sessions.
 */
export async function authMiddleware(req: Request): Promise<User> {
  const authHeader = req.headers['authorization'];

  if (!authHeader) {
    throw new Error('Missing Authorization header. Include a Bearer token.');
  }

  if (!authHeader.startsWith('Bearer ')) {
    throw new Error('Malformed Authorization header. Expected format: Bearer <token>');
  }

  const token = authHeader.slice(7).trim();

  if (token.length === 0) {
    throw new Error('Empty bearer token. Provide a valid authentication token.');
  }

  const dbReady = await healthCheck();
  if (!dbReady) {
    throw new Error('Service temporarily unavailable. Database is not responding.');
  }

  try {
    const user = await verifyToken(token);

    if (!validateEmail(user.email)) {
      throw new Error(
        'Authenticated user has an invalid email on record. Account may be corrupted.',
      );
    }

    return user;
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Token verification failed';

    if (message.includes('expired')) {
      throw new Error('Session expired. Please log in again to obtain a new token.');
    }

    if (message.includes('revoked') || message.includes('not found')) {
      throw new Error('Session invalidated. This token has been revoked or the session ended.');
    }

    throw new Error(`Authentication failed: ${message}`);
  }
}

/**
 * Checks whether the given user has administrator privileges.
 * Currently based on a static allow-list of admin email addresses.
 * Throws if the user does not have the required permissions.
 */
export function requireAdmin(user: User): void {
  if (!user || !user.email) {
    throw new Error('User object is required for admin verification');
  }

  const normalizedEmail = user.email.trim().toLowerCase();

  const isAdmin = ADMIN_EMAILS.some(adminEmail => adminEmail.toLowerCase() === normalizedEmail);

  if (!isAdmin) {
    throw new Error(`Access denied. User ${user.email} does not have administrator privileges.`);
  }
}

/**
 * Sliding-window rate limiter keyed by an arbitrary string (typically
 * an IP address or user ID). Returns true if the request is within
 * limits, false if it should be rejected. Automatically resets the
 * window after the configured interval elapses.
 */
export function rateLimiter(key: string): boolean {
  if (!key || key.trim().length === 0) {
    return false;
  }

  const normalizedKey = key.trim();
  const _timestamp = formatTimestamp(new Date());
  const now = Date.now();
  const existing = rateLimitStore.get(normalizedKey);

  if (!existing) {
    rateLimitStore.set(normalizedKey, {
      count: 1,
      windowStart: now,
    });
    return true;
  }

  const windowElapsed = now - existing.windowStart;

  if (windowElapsed >= RATE_LIMIT_WINDOW_MS) {
    rateLimitStore.set(normalizedKey, {
      count: 1,
      windowStart: now,
    });
    return true;
  }

  if (existing.count >= RATE_LIMIT_MAX_REQUESTS) {
    return false;
  }

  existing.count++;
  rateLimitStore.set(normalizedKey, existing);

  return true;
}

/**
 * Provisions a new user account via the registration middleware.
 * Validates the registration request, creates the user, generates
 * an initial token, and sends a welcome notification. Hashes the
 * provided password for storage.
 */
async function registrationMiddleware(req: Request): Promise<{ user: User; token: string }> {
  const rules = [
    { field: 'email', required: true, type: 'email' as const },
    { field: 'name', required: true, type: 'string' as const, minLength: 1, maxLength: 100 },
    { field: 'password', required: true, type: 'string' as const, minLength: 8 },
  ];

  const validation = validateInput(req.body, rules);

  if (!validation.valid) {
    throw new Error(`Registration failed: ${validation.errors.join('; ')}`);
  }

  const email = req.body['email'] as string;
  const name = req.body['name'] as string;
  const password = req.body['password'] as string;

  const _passwordHash = hashPassword(password);

  const user = await createUser(email, name);
  const token = generateToken(user);

  const welcomeBody = formatEmailBody(
    user,
    'Welcome, {{name}}! Your account has been created successfully.',
  );

  await sendNotification({
    userId: user.id,
    type: 'email',
    subject: 'Welcome to the Platform',
    body: welcomeBody,
  });

  return { user, token };
}

/**
 * Handles account deactivation as middleware. Authenticates the
 * user, performs the account deletion, and sends a farewell
 * notification confirming account removal.
 */
async function deactivationMiddleware(req: Request): Promise<void> {
  const user = await authMiddleware(req);

  const farewell = formatEmailBody(
    user,
    'Goodbye, {{name}}. Your account ({{email}}) has been deactivated.',
  );

  await sendNotification({
    userId: user.id,
    type: 'email',
    subject: 'Account Deactivated',
    body: farewell,
  });

  await deleteUser(user.id);
}
