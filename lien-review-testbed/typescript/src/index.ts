/**
 * Barrel re-exports for the API service.
 * Provides a single entry point for all public functions and types.
 */

// Types
export type {
  User,
  Order,
  OrderItem,
  ApiResponse,
  ValidationResult,
  ValidationRule,
  NotificationPayload,
  Request,
  TransactionContext,
} from './types.js';

// Database
export { query, queryOne, transaction, healthCheck } from './database.js';

// Validation
export { validateEmail, validateInput, sanitizeString } from './validator.js';

// User service
export { getUser, createUser, updateUser, listUsers, deleteUser } from './user-service.js';

// Auth service
export {
  verifyToken,
  login,
  hashPassword,
  generateToken,
  revokeUserSessions,
} from './auth-service.js';

// Notifications
export { sendNotification, notifyUser, notifyBatch, formatEmailBody } from './notification.js';

// API handlers
export {
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

// Middleware
export { authMiddleware, requireAdmin, rateLimiter } from './middleware.js';
