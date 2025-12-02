/**
 * TEST FILE - DELETE BEFORE MERGING
 * 
 * This file contains intentionally complex functions to test the
 * line-specific review comments feature.
 */

// ============================================================
// VIOLATION 1: Deeply nested conditionals (complexity ~20)
// ============================================================
export function processUserRequest(
  user: { role: string; verified: boolean; premium: boolean },
  request: { type: string; priority: number; data: unknown },
  config: { strictMode: boolean; allowGuests: boolean }
): string {
  let result = 'denied';

  if (user.role === 'admin') {
    if (request.type === 'delete') {
      if (request.priority > 5) {
        result = 'admin_delete_high';
      } else {
        if (config.strictMode) {
          result = 'admin_delete_strict';
        } else {
          result = 'admin_delete_normal';
        }
      }
    } else if (request.type === 'update') {
      if (user.verified) {
        result = 'admin_update_verified';
      } else {
        result = 'admin_update_unverified';
      }
    } else {
      result = 'admin_other';
    }
  } else if (user.role === 'moderator') {
    if (request.type === 'delete') {
      if (user.premium) {
        result = 'mod_delete_premium';
      } else {
        result = 'mod_delete_basic';
      }
    } else {
      if (config.allowGuests) {
        result = 'mod_guest_allowed';
      } else {
        result = 'mod_no_guests';
      }
    }
  } else if (user.role === 'user') {
    if (user.verified && user.premium) {
      result = 'user_full_access';
    } else if (user.verified) {
      result = 'user_verified_only';
    } else {
      result = 'user_basic';
    }
  } else {
    if (config.allowGuests) {
      result = 'guest_allowed';
    } else {
      result = 'guest_denied';
    }
  }

  return result;
}

// ============================================================
// VIOLATION 2: Complex switch with nested logic (complexity ~18)
// ============================================================
export function calculateDiscount(
  customerType: 'new' | 'returning' | 'vip' | 'employee',
  orderTotal: number,
  hasPromoCode: boolean,
  isHoliday: boolean,
  membershipYears: number
): number {
  let discount = 0;

  switch (customerType) {
    case 'new':
      discount = 10;
      if (hasPromoCode) {
        discount += 5;
        if (orderTotal > 100) {
          discount += 3;
        }
      }
      if (isHoliday) {
        discount += 2;
      }
      break;

    case 'returning':
      discount = 15;
      if (membershipYears > 2) {
        discount += membershipYears;
        if (membershipYears > 5) {
          discount += 5;
        }
      }
      if (hasPromoCode && orderTotal > 50) {
        discount += 7;
      }
      break;

    case 'vip':
      discount = 25;
      if (orderTotal > 200) {
        discount += 10;
        if (isHoliday) {
          discount += 5;
        }
      }
      if (membershipYears > 3) {
        discount += membershipYears * 2;
      }
      break;

    case 'employee':
      discount = 30;
      if (isHoliday) {
        discount += 10;
      }
      break;

    default:
      discount = 0;
  }

  // Cap discount at 50%
  return Math.min(discount, 50);
}

// ============================================================
// VIOLATION 3: Multiple boolean conditions (complexity ~15)
// ============================================================
export function shouldSendNotification(
  user: { 
    emailEnabled: boolean; 
    smsEnabled: boolean; 
    pushEnabled: boolean;
    quietHoursStart: number;
    quietHoursEnd: number;
  },
  notification: {
    type: 'marketing' | 'transactional' | 'urgent';
    channel: 'email' | 'sms' | 'push';
  },
  currentHour: number
): boolean {
  // Check quiet hours
  const inQuietHours = currentHour >= user.quietHoursStart && 
                       currentHour < user.quietHoursEnd;

  if (notification.type === 'urgent') {
    // Urgent notifications bypass quiet hours
    if (notification.channel === 'email' && user.emailEnabled) {
      return true;
    }
    if (notification.channel === 'sms' && user.smsEnabled) {
      return true;
    }
    if (notification.channel === 'push' && user.pushEnabled) {
      return true;
    }
    return false;
  }

  if (inQuietHours) {
    return false;
  }

  if (notification.type === 'marketing') {
    if (notification.channel === 'email' && user.emailEnabled) {
      return true;
    }
    if (notification.channel === 'push' && user.pushEnabled) {
      return true;
    }
    // No marketing SMS
    return false;
  }

  if (notification.type === 'transactional') {
    if (notification.channel === 'email' && user.emailEnabled) {
      return true;
    }
    if (notification.channel === 'sms' && user.smsEnabled) {
      return true;
    }
    if (notification.channel === 'push' && user.pushEnabled) {
      return true;
    }
  }

  return false;
}

// ============================================================
// VIOLATION 4: Loop with multiple conditions (complexity ~12)
// ============================================================
export function filterAndTransformItems(
  items: Array<{ 
    id: number; 
    status: string; 
    price: number; 
    category: string;
    stock: number;
  }>,
  filters: {
    minPrice?: number;
    maxPrice?: number;
    categories?: string[];
    inStockOnly?: boolean;
    statuses?: string[];
  }
): Array<{ id: number; displayPrice: string; available: boolean }> {
  const result: Array<{ id: number; displayPrice: string; available: boolean }> = [];

  for (const item of items) {
    // Price filter
    if (filters.minPrice !== undefined && item.price < filters.minPrice) {
      continue;
    }
    if (filters.maxPrice !== undefined && item.price > filters.maxPrice) {
      continue;
    }

    // Category filter
    if (filters.categories && filters.categories.length > 0) {
      if (!filters.categories.includes(item.category)) {
        continue;
      }
    }

    // Stock filter
    if (filters.inStockOnly && item.stock <= 0) {
      continue;
    }

    // Status filter
    if (filters.statuses && filters.statuses.length > 0) {
      if (!filters.statuses.includes(item.status)) {
        continue;
      }
    }

    // Transform
    result.push({
      id: item.id,
      displayPrice: `$${item.price.toFixed(2)}`,
      available: item.stock > 0,
    });
  }

  return result;
}

