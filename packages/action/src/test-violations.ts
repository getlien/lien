/**
 * TEST FILE - DELETE BEFORE MERGING
 * Tests hybrid mode: errors get inline comments, warnings get summary
 */

// ERROR: complexity ~35 (needs >= 30 for error at threshold 15)
// This monster function should definitely trigger an error!
export function processComplexRequest(
  user: { role: string; verified: boolean; premium: boolean; level: number },
  request: { type: string; priority: number; urgent: boolean },
  config: { strictMode: boolean; allowGuests: boolean; maxRetries: number },
  context: { isWeekend: boolean; serverLoad: number }
): string {
  let result = 'denied';
  
  if (user.role === 'admin') {
    if (request.type === 'delete') {
      if (request.priority > 5) {
        if (request.urgent) {
          if (context.serverLoad < 80) {
            result = 'admin_delete_urgent_ok';
          } else {
            result = 'admin_delete_urgent_busy';
          }
        } else {
          result = 'admin_delete_high';
        }
      } else {
        if (config.strictMode) {
          if (user.verified) {
            result = 'admin_delete_strict_verified';
          } else {
            result = 'admin_delete_strict_unverified';
          }
        } else {
          result = 'admin_delete_normal';
        }
      }
    } else if (request.type === 'update') {
      if (user.verified) {
        if (user.premium) {
          result = 'admin_update_premium';
        } else {
          result = 'admin_update_verified';
        }
      } else {
        result = 'admin_update_unverified';
      }
    } else if (request.type === 'create') {
      if (context.isWeekend) {
        if (user.level > 5) {
          result = 'admin_create_weekend_senior';
        } else {
          result = 'admin_create_weekend_junior';
        }
      } else {
        result = 'admin_create_weekday';
      }
    } else {
      result = 'admin_other';
    }
  } else if (user.role === 'moderator') {
    if (request.type === 'delete') {
      if (user.premium) {
        if (config.maxRetries > 3) {
          result = 'mod_delete_premium_retry';
        } else {
          result = 'mod_delete_premium';
        }
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
      if (user.level > 10) {
        result = 'user_vip';
      } else {
        result = 'user_full_access';
      }
    } else if (user.verified) {
      result = 'user_verified_only';
    } else {
      result = 'user_basic';
    }
  } else {
    if (config.allowGuests) {
      if (context.isWeekend) {
        result = 'guest_weekend';
      } else {
        result = 'guest_weekday';
      }
    } else {
      result = 'guest_denied';
    }
  }
  
  return result;
}

// WARNING: complexity ~18 (>= 15 but < 30) - should be in SUMMARY only
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
