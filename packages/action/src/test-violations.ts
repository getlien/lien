/**
 * TEST FILE - DELETE BEFORE MERGING
 * Tests hybrid mode: errors get inline comments, warnings get summary
 */

// ERROR: complexity > 2x threshold (30 > 2*15) - should get INLINE comment
export function processUserRequest(
  user: { role: string; verified: boolean; premium: boolean },
  request: { type: string; priority: number },
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

// WARNING: complexity > threshold but < 2x (18 > 15 but < 30) - should be in SUMMARY
export function calculateDiscount(
  type: 'new' | 'returning' | 'vip',
  total: number,
  hasPromo: boolean
): number {
  let discount = 0;
  switch (type) {
    case 'new':
      discount = 10;
      if (hasPromo) {
        discount += 5;
        if (total > 100) {
          discount += 3;
        }
      }
      break;
    case 'returning':
      discount = 15;
      if (total > 50) {
        discount += 5;
      }
      if (hasPromo) {
        discount += 7;
      }
      break;
    case 'vip':
      discount = 25;
      if (total > 200) {
        discount += 10;
      }
      break;
  }
  return Math.min(discount, 50);
}

