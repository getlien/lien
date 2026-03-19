/**
 * Notification service for sending emails, SMS, and push notifications.
 * Fetches user details to personalize messages and supports batch delivery.
 */

import type { NotificationPayload, User } from './types.js';
import { getUser, listUsers } from './user-service.js';
import { sanitizeString, validateEmail } from './validator.js';

interface NotificationLog {
  id: string;
  payload: NotificationPayload;
  sentAt: Date;
  status: 'sent' | 'failed' | 'queued';
}

const notificationHistory: NotificationLog[] = [];

const TEMPLATE_VARIABLE_REGEX = /\{\{(\w+)\}\}/g;

/**
 * Sends a single notification to a user via the specified channel.
 * Validates the payload fields, logs the attempt, and simulates
 * delivery through the appropriate transport (email, SMS, or push).
 * Throws if the payload is missing required fields.
 */
export async function sendNotification(payload: NotificationPayload): Promise<void> {
  if (!payload.userId || payload.userId.trim().length === 0) {
    throw new Error('Notification requires a valid userId');
  }

  if (!payload.subject || payload.subject.trim().length === 0) {
    throw new Error('Notification requires a non-empty subject');
  }

  if (!payload.body || payload.body.trim().length === 0) {
    throw new Error('Notification requires a non-empty body');
  }

  const validTypes = ['email', 'sms', 'push'] as const;
  if (!validTypes.includes(payload.type)) {
    throw new Error(
      `Invalid notification type "${payload.type}". Must be one of: ${validTypes.join(', ')}`,
    );
  }

  const logEntry: NotificationLog = {
    id: generateNotificationId(),
    payload: { ...payload },
    sentAt: new Date(),
    status: 'queued',
  };

  try {
    if (payload.type === 'email') {
      await deliverEmail(payload);
    } else if (payload.type === 'sms') {
      await deliverSms(payload);
    } else {
      await deliverPush(payload);
    }

    logEntry.status = 'sent';
  } catch (error) {
    logEntry.status = 'failed';
    const message = error instanceof Error ? error.message : 'Unknown delivery error';
    throw new Error(`Failed to send ${payload.type} notification: ${message}`);
  } finally {
    notificationHistory.push(logEntry);
  }
}

/**
 * Convenience method to send an email notification to a single user.
 * Fetches the user record to personalize the message body using
 * template variables, then delegates to sendNotification.
 */
export async function notifyUser(userId: string, subject: string, body: string): Promise<void> {
  const user = await getUser(userId);

  if (!validateEmail(user.email)) {
    throw new Error(`Cannot send notification: user ${userId} has an invalid email address`);
  }

  const sanitizedSubject = sanitizeString(subject);
  const personalizedBody = formatEmailBody(user, body);

  const payload: NotificationPayload = {
    userId,
    type: 'email',
    subject: sanitizedSubject,
    body: personalizedBody,
  };

  await sendNotification(payload);
}

/**
 * Sends the same notification to multiple users in sequence.
 * Collects errors per user but does not abort on individual
 * failures — all users are attempted. Throws an aggregate
 * error if any deliveries failed.
 */
export async function notifyBatch(userIds: string[], subject: string, body: string): Promise<void> {
  if (!userIds || userIds.length === 0) {
    throw new Error('At least one user ID is required for batch notification');
  }

  const uniqueIds = [...new Set(userIds)];
  const errors: Array<{ userId: string; error: string }> = [];

  for (const userId of uniqueIds) {
    try {
      const user = await getUser(userId);
      const personalizedBody = formatEmailBody(user, body);

      await sendNotification({
        userId,
        type: 'email',
        subject,
        body: personalizedBody,
      });
    } catch (error) {
      const message = error instanceof Error ? error.message : 'Unknown error';
      errors.push({ userId, error: message });
    }
  }

  if (errors.length > 0) {
    const failedIds = errors.map(e => e.userId).join(', ');
    throw new Error(
      `Batch notification partially failed. Failed for users: ${failedIds}. ` +
        `${errors.length}/${uniqueIds.length} deliveries failed.`,
    );
  }
}

/**
 * Renders a template string by replacing {{variable}} placeholders
 * with the corresponding values from the user object.
 * Supports {{name}}, {{email}}, and {{id}} variables.
 * Unknown variables are left as-is in the output.
 */
export function formatEmailBody(user: User, template: string): string {
  if (!template || template.length === 0) {
    return '';
  }

  const variables: Record<string, string> = {
    name: user.name,
    email: user.email,
    id: user.id,
  };

  const rendered = template.replace(TEMPLATE_VARIABLE_REGEX, (match, variableName: string) => {
    const value = variables[variableName];
    return value !== undefined ? value : match;
  });

  return rendered;
}

/**
 * Broadcasts a notification to all users in the system.
 * Fetches users in paginated batches and sends the notification
 * to each one. Uses listUsers for pagination to avoid loading
 * all users into memory at once.
 */
async function notifyAllUsers(
  subject: string,
  body: string,
): Promise<{ sent: number; failed: number }> {
  const sanitizedSubject = sanitizeString(subject);
  let page = 1;
  const batchSize = 50;
  let sent = 0;
  let failed = 0;
  let hasMore = true;

  while (hasMore) {
    const users = await listUsers(page, batchSize);

    if (users.length === 0) {
      hasMore = false;
      break;
    }

    for (const user of users) {
      try {
        if (!validateEmail(user.email)) {
          failed++;
          continue;
        }

        const personalizedBody = formatEmailBody(user, body);

        await sendNotification({
          userId: user.id,
          type: 'email',
          subject: sanitizedSubject,
          body: personalizedBody,
        });
        sent++;
      } catch {
        failed++;
      }
    }

    if (users.length < batchSize) {
      hasMore = false;
    }
    page++;
  }

  return { sent, failed };
}

async function deliverEmail(payload: NotificationPayload): Promise<void> {
  if (payload.body.length > 50_000) {
    throw new Error('Email body exceeds maximum length of 50,000 characters');
  }
  await simulateNetworkDelay();
}

async function deliverSms(payload: NotificationPayload): Promise<void> {
  if (payload.body.length > 160) {
    throw new Error('SMS body exceeds maximum length of 160 characters');
  }
  await simulateNetworkDelay();
}

async function deliverPush(payload: NotificationPayload): Promise<void> {
  if (payload.subject.length > 100) {
    throw new Error('Push notification title exceeds maximum length of 100 characters');
  }
  await simulateNetworkDelay();
}

async function simulateNetworkDelay(): Promise<void> {
  return new Promise(resolve => setTimeout(resolve, 1));
}

function generateNotificationId(): string {
  const timestamp = Date.now().toString(36);
  const random = Math.random().toString(36).slice(2, 8);
  return `notif_${timestamp}_${random}`;
}
