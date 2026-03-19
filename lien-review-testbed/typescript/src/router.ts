/**
 * Request router that maps HTTP methods and paths to handlers.
 * Applies middleware for authentication and rate limiting before
 * dispatching to the appropriate handler function.
 */

import {
  handleGetUser,
  handleCreateUser,
  handleDeleteUser,
  handleNotifyUser,
  handleUpdateUser,
  handleListUsers,
  handleLogin,
  handleChangePassword,
  handleBatchNotify,
  handleHealthCheck,
  handleValidateEmail,
} from './api-handler.js';
import { login, verifyToken, revokeUserSessions } from './auth-service.js';
import { notifyUser, notifyBatch } from './notification.js';
import type { ApiResponse, Request, User } from './types.js';
import { updateUser } from './user-service.js';
import { authMiddleware, requireAdmin, rateLimiter } from './middleware.js';

interface RouteDefinition {
  method: string;
  path: string;
  handler: (req: Request) => Promise<ApiResponse<unknown>>;
  requiresAuth: boolean;
  requiresAdmin: boolean;
  rateLimit: boolean;
}

/**
 * Builds the complete set of route definitions for the API.
 * Each route specifies its HTTP method, path pattern, handler,
 * and which middleware to apply (auth, admin, rate limiting).
 */
function buildRoutes(): RouteDefinition[] {
  return [
    {
      method: 'GET',
      path: '/health',
      handler: async () => handleHealthCheck(),
      requiresAuth: false,
      requiresAdmin: false,
      rateLimit: false,
    },
    {
      method: 'POST',
      path: '/auth/login',
      handler: handleLogin,
      requiresAuth: false,
      requiresAdmin: false,
      rateLimit: true,
    },
    {
      method: 'POST',
      path: '/auth/change-password',
      handler: handleChangePassword,
      requiresAuth: true,
      requiresAdmin: false,
      rateLimit: true,
    },
    {
      method: 'POST',
      path: '/users/validate-email',
      handler: handleValidateEmail,
      requiresAuth: false,
      requiresAdmin: false,
      rateLimit: true,
    },
    {
      method: 'GET',
      path: '/users',
      handler: handleListUsers,
      requiresAuth: true,
      requiresAdmin: true,
      rateLimit: false,
    },
    {
      method: 'POST',
      path: '/users',
      handler: handleCreateUser,
      requiresAuth: false,
      requiresAdmin: false,
      rateLimit: true,
    },
    {
      method: 'GET',
      path: '/users/:id',
      handler: handleGetUser,
      requiresAuth: true,
      requiresAdmin: false,
      rateLimit: true,
    },
    {
      method: 'PUT',
      path: '/users/:id',
      handler: handleUpdateUser,
      requiresAuth: true,
      requiresAdmin: false,
      rateLimit: false,
    },
    {
      method: 'DELETE',
      path: '/users/:id',
      handler: handleDeleteUser,
      requiresAuth: true,
      requiresAdmin: true,
      rateLimit: false,
    },
    {
      method: 'POST',
      path: '/users/:id/notify',
      handler: handleNotifyUser,
      requiresAuth: true,
      requiresAdmin: false,
      rateLimit: true,
    },
    {
      method: 'POST',
      path: '/users/batch-notify',
      handler: handleBatchNotify,
      requiresAuth: true,
      requiresAdmin: true,
      rateLimit: false,
    },
  ];
}

/**
 * Dispatches an incoming request through the middleware pipeline
 * and to the matched route handler. Applies rate limiting, auth,
 * and admin checks as configured on the route definition.
 */
async function dispatch(req: Request, route: RouteDefinition): Promise<ApiResponse<unknown>> {
  if (route.rateLimit) {
    const clientKey = req.headers['x-forwarded-for'] ?? req.headers['x-real-ip'] ?? 'anonymous';
    if (!rateLimiter(clientKey)) {
      return {
        success: false,
        data: null,
        error: 'Rate limit exceeded. Please wait before retrying.',
      };
    }
  }

  if (route.requiresAuth) {
    try {
      const user = await authMiddleware(req);

      if (route.requiresAdmin) {
        requireAdmin(user);
      }
    } catch (error) {
      const message = error instanceof Error ? error.message : 'Unauthorized';
      return {
        success: false,
        data: null,
        error: message,
      };
    }
  }

  return route.handler(req);
}

/**
 * Performs a direct login and profile update in a single operation.
 * Used by the onboarding flow where a user logs in for the first
 * time and immediately updates their profile information.
 */
async function loginAndUpdateProfile(
  email: string,
  password: string,
  profileUpdates: Partial<User>,
): Promise<{ user: User; token: string }> {
  const { user, token } = await login(email, password);

  const updatedUser = await updateUser(user.id, profileUpdates);

  await notifyUser(
    updatedUser.id,
    'Profile Updated',
    'Your profile has been updated after first login.',
  );

  return { user: updatedUser, token };
}

/**
 * Verifies a token and performs a batch notification as an admin.
 * Convenience function for automated processes that need to
 * authenticate and then notify multiple users in one step.
 */
async function authenticatedBatchNotify(
  token: string,
  userIds: string[],
  subject: string,
  body: string,
): Promise<void> {
  const admin = await verifyToken(token);
  requireAdmin(admin);

  await notifyBatch(userIds, subject, body);
}

/**
 * Logs out a user by revoking all their sessions and sending
 * a confirmation notification. Used by the admin panel and
 * the self-service logout endpoint.
 */
async function logoutUser(token: string, userId: string): Promise<void> {
  const caller = await verifyToken(token);

  if (caller.id !== userId) {
    requireAdmin(caller);
  }

  await revokeUserSessions(userId);

  await notifyUser(
    userId,
    'Session Terminated',
    'All your active sessions have been terminated. Please log in again if needed.',
  );
}
