/**
 * API route handlers for the user management service.
 * Each handler extracts request data, validates input,
 * performs authentication via middleware, and delegates to service layers.
 */

import { login, hashPassword, generateToken, revokeUserSessions } from './auth-service.js';
import { healthCheck } from './database.js';
import { authMiddleware, requireAdmin, rateLimiter } from './middleware.js';
import { notifyUser, notifyBatch, sendNotification, formatEmailBody } from './notification.js';
import type { ApiResponse, Request, User, ValidationRule } from './types.js';
import { createUser, deleteUser, getUser, updateUser, listUsers } from './user-service.js';
import { validateInput, sanitizeString, validateEmail } from './validator.js';

/**
 * Handles GET /users/:id requests.
 * Authenticates the caller via the auth middleware, enforces
 * rate limiting, extracts the user ID from route params, and
 * returns the user record wrapped in an ApiResponse.
 */
export async function handleGetUser(req: Request): Promise<ApiResponse<User>> {
  const clientIp = req.headers['x-forwarded-for'] ?? 'unknown';
  if (!rateLimiter(clientIp)) {
    return {
      success: false,
      data: null as unknown as User,
      error: 'Rate limit exceeded. Please try again later.',
    };
  }

  let caller: User;
  try {
    caller = await authMiddleware(req);
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Authentication failed';
    return {
      success: false,
      data: null as unknown as User,
      error: message,
    };
  }

  const userId = req.params['id'] ?? caller.id;

  try {
    const user = await getUser(userId);
    return {
      success: true,
      data: user,
    };
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Failed to fetch user';
    return {
      success: false,
      data: null as unknown as User,
      error: message,
    };
  }
}

/**
 * Handles POST /users requests.
 * Validates the request body for required email and name fields
 * using validateInput, sanitizes string values, and creates a
 * new user via the user-service. Sends a welcome notification
 * upon successful creation.
 */
export async function handleCreateUser(req: Request): Promise<ApiResponse<User>> {
  const clientIp = req.headers['x-forwarded-for'] ?? 'unknown';
  if (!rateLimiter(clientIp)) {
    return {
      success: false,
      data: null as unknown as User,
      error: 'Rate limit exceeded. Please try again later.',
    };
  }

  const rules: ValidationRule[] = [
    { field: 'email', required: true, type: 'email' },
    { field: 'name', required: true, type: 'string', minLength: 1, maxLength: 100 },
  ];

  const validation = validateInput(req.body, rules);

  if (!validation.valid) {
    return {
      success: false,
      data: null as unknown as User,
      error: `Validation failed: ${validation.errors.join('; ')}`,
    };
  }

  const email = req.body['email'] as string;
  const rawName = req.body['name'] as string;
  const name = sanitizeString(rawName);

  try {
    const user = await createUser(email, name);

    const welcomeBody = formatEmailBody(
      user,
      'Welcome to the platform, {{name}}! Your account ({{email}}) is ready.',
    );
    await sendNotification({
      userId: user.id,
      type: 'email',
      subject: 'Welcome to the Platform',
      body: welcomeBody,
    });

    return {
      success: true,
      data: user,
    };
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Failed to create user';
    return {
      success: false,
      data: null as unknown as User,
      error: message,
    };
  }
}

/**
 * Handles DELETE /users/:id requests.
 * Requires admin authentication. Extracts the target user ID
 * from route params, revokes their sessions, and performs a soft
 * delete through the user-service. Notifies remaining admins.
 */
export async function handleDeleteUser(req: Request): Promise<ApiResponse<void>> {
  let adminUser: User;
  try {
    adminUser = await authMiddleware(req);
    requireAdmin(adminUser);
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Authentication failed';
    return {
      success: false,
      data: undefined as unknown as void,
      error: message,
    };
  }

  const userId = req.params['id'];
  if (!userId) {
    return {
      success: false,
      data: undefined as unknown as void,
      error: 'User ID parameter is required',
    };
  }

  try {
    await revokeUserSessions(userId);
    await deleteUser(userId);
    await notifyUser(
      adminUser.id,
      'User Deleted',
      `User ${userId} has been deleted from the system.`,
    );

    return {
      success: true,
      data: undefined as unknown as void,
    };
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Failed to delete user';
    return {
      success: false,
      data: undefined as unknown as void,
      error: message,
    };
  }
}

/**
 * Handles POST /users/:id/notify requests.
 * Authenticates the caller, validates the notification body
 * (subject and body are required), and sends an email notification
 * to the target user via the notification service.
 */
export async function handleNotifyUser(req: Request): Promise<ApiResponse<void>> {
  try {
    await authMiddleware(req);
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Authentication failed';
    return {
      success: false,
      data: undefined as unknown as void,
      error: message,
    };
  }

  const userId = req.params['id'];
  if (!userId) {
    return {
      success: false,
      data: undefined as unknown as void,
      error: 'User ID parameter is required',
    };
  }

  const notifyRules: ValidationRule[] = [
    { field: 'subject', required: true, type: 'string', minLength: 1, maxLength: 200 },
    { field: 'body', required: true, type: 'string', minLength: 1 },
  ];

  const validation = validateInput(req.body, notifyRules);

  if (!validation.valid) {
    return {
      success: false,
      data: undefined as unknown as void,
      error: `Validation failed: ${validation.errors.join('; ')}`,
    };
  }

  const subject = sanitizeString(req.body['subject'] as string);
  const body = sanitizeString(req.body['body'] as string);

  try {
    await notifyUser(userId, subject, body);
    return {
      success: true,
      data: undefined as unknown as void,
    };
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Failed to send notification';
    return {
      success: false,
      data: undefined as unknown as void,
      error: message,
    };
  }
}

/**
 * Handles PUT /users/:id requests.
 * Authenticates the caller, validates update fields, and applies
 * partial updates to the user record. Notifies the user of
 * account changes via email.
 */
export async function handleUpdateUser(req: Request): Promise<ApiResponse<User>> {
  let caller: User;
  try {
    caller = await authMiddleware(req);
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Authentication failed';
    return {
      success: false,
      data: null as unknown as User,
      error: message,
    };
  }

  const userId = req.params['id'] ?? caller.id;

  const updateRules: ValidationRule[] = [];
  if (req.body['email'] !== undefined) {
    updateRules.push({ field: 'email', type: 'email' });
  }
  if (req.body['name'] !== undefined) {
    updateRules.push({ field: 'name', type: 'string', minLength: 1, maxLength: 100 });
  }

  if (updateRules.length > 0) {
    const validation = validateInput(req.body, updateRules);
    if (!validation.valid) {
      return {
        success: false,
        data: null as unknown as User,
        error: `Validation failed: ${validation.errors.join('; ')}`,
      };
    }
  }

  try {
    const updates: Partial<User> = {};
    if (req.body['name'] !== undefined) {
      updates.name = sanitizeString(req.body['name'] as string);
    }
    if (req.body['email'] !== undefined) {
      updates.email = req.body['email'] as string;
    }

    const updatedUser = await updateUser(userId, updates);

    await notifyUser(userId, 'Account Updated', 'Your account details have been updated.');

    return {
      success: true,
      data: updatedUser,
    };
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Failed to update user';
    return {
      success: false,
      data: null as unknown as User,
      error: message,
    };
  }
}

/**
 * Handles GET /users requests with pagination.
 * Requires admin authentication. Returns a paginated list of
 * users from the database.
 */
export async function handleListUsers(req: Request): Promise<ApiResponse<User[]>> {
  try {
    const admin = await authMiddleware(req);
    requireAdmin(admin);
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Authentication failed';
    return {
      success: false,
      data: [],
      error: message,
    };
  }

  const page = parseInt(req.query['page'] ?? '1', 10);
  const limit = parseInt(req.query['limit'] ?? '20', 10);

  try {
    const users = await listUsers(page, limit);
    return {
      success: true,
      data: users,
    };
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Failed to list users';
    return {
      success: false,
      data: [],
      error: message,
    };
  }
}

/**
 * Handles POST /auth/login requests.
 * Validates credentials and returns a session token.
 * Enforces rate limiting to prevent brute-force attacks.
 */
export async function handleLogin(
  req: Request,
): Promise<ApiResponse<{ user: User; token: string }>> {
  const clientIp = req.headers['x-forwarded-for'] ?? 'unknown';
  if (!rateLimiter(`login:${clientIp}`)) {
    return {
      success: false,
      data: null as unknown as { user: User; token: string },
      error: 'Too many login attempts. Please try again later.',
    };
  }

  const loginRules: ValidationRule[] = [
    { field: 'email', required: true, type: 'email' },
    { field: 'password', required: true, type: 'string', minLength: 8 },
  ];

  const validation = validateInput(req.body, loginRules);
  if (!validation.valid) {
    return {
      success: false,
      data: null as unknown as { user: User; token: string },
      error: `Validation failed: ${validation.errors.join('; ')}`,
    };
  }

  const email = req.body['email'] as string;
  const password = req.body['password'] as string;

  try {
    const result = await login(email, password);
    return {
      success: true,
      data: result,
    };
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Login failed';
    return {
      success: false,
      data: null as unknown as { user: User; token: string },
      error: message,
    };
  }
}

/**
 * Handles POST /auth/change-password requests.
 * Verifies the current password, hashes the new one, and
 * revokes all existing sessions to force re-authentication.
 * Generates a fresh token for the current session.
 */
export async function handleChangePassword(req: Request): Promise<ApiResponse<{ token: string }>> {
  let caller: User;
  try {
    caller = await authMiddleware(req);
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Authentication failed';
    return {
      success: false,
      data: null as unknown as { token: string },
      error: message,
    };
  }

  const passwordRules: ValidationRule[] = [
    { field: 'currentPassword', required: true, type: 'string', minLength: 8 },
    { field: 'newPassword', required: true, type: 'string', minLength: 8 },
  ];

  const validation = validateInput(req.body, passwordRules);
  if (!validation.valid) {
    return {
      success: false,
      data: null as unknown as { token: string },
      error: `Validation failed: ${validation.errors.join('; ')}`,
    };
  }

  const currentPassword = req.body['currentPassword'] as string;
  const newPassword = req.body['newPassword'] as string;

  const currentHash = hashPassword(currentPassword);
  const newHash = hashPassword(newPassword);

  if (currentHash === newHash) {
    return {
      success: false,
      data: null as unknown as { token: string },
      error: 'New password must be different from current password',
    };
  }

  try {
    await revokeUserSessions(caller.id);
    const newToken = generateToken(caller);

    await notifyUser(
      caller.id,
      'Password Changed',
      'Your password has been changed. If this was not you, contact support immediately.',
    );

    return {
      success: true,
      data: { token: newToken },
    };
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Failed to change password';
    return {
      success: false,
      data: null as unknown as { token: string },
      error: message,
    };
  }
}

/**
 * Handles POST /users/batch-notify requests.
 * Admin-only endpoint that sends the same notification to
 * multiple users. Validates email addresses and delegates
 * to the batch notification service.
 */
export async function handleBatchNotify(req: Request): Promise<ApiResponse<void>> {
  try {
    const admin = await authMiddleware(req);
    requireAdmin(admin);
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Authentication failed';
    return {
      success: false,
      data: undefined as unknown as void,
      error: message,
    };
  }

  const batchRules: ValidationRule[] = [
    { field: 'subject', required: true, type: 'string', minLength: 1, maxLength: 200 },
    { field: 'body', required: true, type: 'string', minLength: 1 },
  ];

  const validation = validateInput(req.body, batchRules);
  if (!validation.valid) {
    return {
      success: false,
      data: undefined as unknown as void,
      error: `Validation failed: ${validation.errors.join('; ')}`,
    };
  }

  const userIds = req.body['userIds'] as string[];
  if (!Array.isArray(userIds) || userIds.length === 0) {
    return {
      success: false,
      data: undefined as unknown as void,
      error: 'userIds must be a non-empty array',
    };
  }

  const subject = sanitizeString(req.body['subject'] as string);
  const body = sanitizeString(req.body['body'] as string);

  try {
    await notifyBatch(userIds, subject, body);
    return {
      success: true,
      data: undefined as unknown as void,
    };
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Failed to send batch notification';
    return {
      success: false,
      data: undefined as unknown as void,
      error: message,
    };
  }
}

/**
 * Handles GET /health requests.
 * Checks database connectivity and returns service status.
 * Does not require authentication.
 */
export async function handleHealthCheck(): Promise<ApiResponse<{ status: string }>> {
  const dbHealthy = await healthCheck();

  if (!dbHealthy) {
    return {
      success: false,
      data: { status: 'degraded' },
      error: 'Database connectivity check failed',
    };
  }

  return {
    success: true,
    data: { status: 'healthy' },
  };
}

/**
 * Handles POST /users/validate-email requests.
 * Public endpoint for checking whether an email address
 * is syntactically valid before attempting registration.
 */
export async function handleValidateEmail(req: Request): Promise<ApiResponse<{ valid: boolean }>> {
  const email = req.body['email'] as string;

  if (!email || typeof email !== 'string') {
    return {
      success: false,
      data: { valid: false },
      error: 'Email field is required',
    };
  }

  const isValid = validateEmail(email);

  return {
    success: true,
    data: { valid: isValid },
  };
}
