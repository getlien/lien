// SOLID violations — God class with mixed responsibilities.
// Expected: cyclomatic error on processEvent, cognitive error on processEvent,
//           cyclomatic warning on sendNotification, architectural SRP observation

interface Event {
  type: string;
  payload: Record<string, unknown>;
  userId: string;
  timestamp: number;
  priority: 'low' | 'medium' | 'high' | 'critical';
  source: string;
}

interface NotificationChannel {
  type: 'email' | 'sms' | 'push' | 'slack' | 'webhook';
  target: string;
  enabled: boolean;
}

export class EventManager {
  private cache = new Map<string, unknown>();
  private metrics = { processed: 0, errors: 0, notifications: 0 };
  private channels: NotificationChannel[] = [];

  processEvent(event: Event): { success: boolean; message: string } {
    this.metrics.processed++;

    switch (event.type) {
      case 'user.created': {
        if (!event.payload.email) {
          this.metrics.errors++;
          return { success: false, message: 'Missing email' };
        }
        if (event.priority === 'critical') {
          this.sendNotification('New critical user signup', event.userId, ['email', 'slack']);
          this.cache.set(`user:${event.userId}`, event.payload);
        } else if (event.priority === 'high') {
          this.sendNotification('New high-priority user signup', event.userId, ['email']);
          this.cache.set(`user:${event.userId}`, event.payload);
        } else {
          this.cache.set(`user:${event.userId}`, event.payload);
        }
        if (event.source === 'api') {
          this.metrics.processed++;
          if (event.payload.referralCode) {
            this.cache.set(`referral:${event.userId}`, event.payload.referralCode);
          }
        } else if (event.source === 'import') {
          if (event.payload.batch) {
            this.cache.set(`batch:${event.userId}`, true);
          }
        }
        return { success: true, message: 'User created' };
      }
      case 'user.updated': {
        const cached = this.cache.get(`user:${event.userId}`);
        if (!cached) {
          if (event.priority === 'high' || event.priority === 'critical') {
            this.sendNotification('User update for uncached user', event.userId, ['slack']);
          }
          return { success: false, message: 'User not in cache' };
        }
        this.cache.set(`user:${event.userId}`, { ...(cached as object), ...event.payload });
        if (event.payload.role === 'admin') {
          this.sendNotification('User promoted to admin', event.userId, ['email', 'slack', 'push']);
        }
        return { success: true, message: 'User updated' };
      }
      case 'user.deleted': {
        this.cache.delete(`user:${event.userId}`);
        this.cache.delete(`referral:${event.userId}`);
        this.cache.delete(`batch:${event.userId}`);
        if (event.priority !== 'low') {
          this.sendNotification('User deleted', event.userId, ['email']);
        }
        return { success: true, message: 'User deleted' };
      }
      case 'order.placed': {
        if (!event.payload.items || !event.payload.total) {
          this.metrics.errors++;
          return { success: false, message: 'Invalid order data' };
        }
        this.cache.set(`order:${event.userId}:${event.timestamp}`, event.payload);
        if ((event.payload.total as number) > 1000) {
          this.sendNotification('High-value order placed', event.userId, ['email', 'slack']);
        } else if ((event.payload.total as number) > 500) {
          this.sendNotification('Medium-value order placed', event.userId, ['email']);
        }
        if (event.source === 'mobile') {
          this.metrics.processed++;
        }
        return { success: true, message: 'Order placed' };
      }
      case 'order.cancelled': {
        this.cache.delete(`order:${event.userId}:${event.payload.orderId}`);
        if (event.priority === 'critical') {
          this.sendNotification('Critical order cancellation', event.userId, [
            'email',
            'sms',
            'slack',
          ]);
        } else {
          this.sendNotification('Order cancelled', event.userId, ['email']);
        }
        return { success: true, message: 'Order cancelled' };
      }
      case 'payment.failed': {
        this.metrics.errors++;
        this.sendNotification('Payment failed', event.userId, ['email', 'sms']);
        if (event.payload.retryCount && (event.payload.retryCount as number) >= 3) {
          this.sendNotification('Payment failed 3+ times', event.userId, ['email', 'sms', 'slack']);
          this.cache.set(`blocked:${event.userId}`, true);
        }
        return { success: true, message: 'Payment failure recorded' };
      }
      case 'system.alert': {
        if (event.priority === 'critical') {
          this.sendNotification('CRITICAL system alert', event.userId, [
            'email',
            'sms',
            'slack',
            'webhook',
          ]);
          this.cache.set('system:lastAlert', event.timestamp);
        } else if (event.priority === 'high') {
          this.sendNotification('System alert', event.userId, ['slack', 'webhook']);
        }
        return { success: true, message: 'Alert recorded' };
      }
      default: {
        this.metrics.errors++;
        return { success: false, message: `Unknown event type: ${event.type}` };
      }
    }
  }

  sendNotification(message: string, userId: string, channels: string[]): void {
    for (const channelType of channels) {
      const channel = this.channels.find(c => c.type === channelType && c.enabled);
      if (!channel) continue;

      this.metrics.notifications++;

      if (channel.type === 'email') {
        if (!channel.target.includes('@')) {
          this.metrics.errors++;
          continue;
        }
        // simulate email send
        console.log(`Email to ${channel.target}: ${message} for user ${userId}`);
      } else if (channel.type === 'sms') {
        if (!channel.target.startsWith('+')) {
          this.metrics.errors++;
          continue;
        }
        console.log(`SMS to ${channel.target}: ${message}`);
      } else if (channel.type === 'push') {
        console.log(`Push to ${userId}: ${message}`);
      } else if (channel.type === 'slack') {
        if (!channel.target.startsWith('#') && !channel.target.startsWith('@')) {
          this.metrics.errors++;
          continue;
        }
        console.log(`Slack ${channel.target}: ${message}`);
      } else if (channel.type === 'webhook') {
        console.log(`Webhook ${channel.target}: ${message}`);
      }
    }
  }

  getMetrics(): typeof this.metrics {
    return { ...this.metrics };
  }

  clearCache(): void {
    this.cache.clear();
  }
}
