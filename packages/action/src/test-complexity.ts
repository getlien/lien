/**
 * Test file with intentionally complex functions to test Veille review quality
 * This file should trigger multiple complexity violations across different metrics
 */

/**
 * High cyclomatic complexity - many conditional branches
 */
export function validateUserPermissions(
  user: { role: string; permissions: string[]; isActive: boolean },
  resource: string,
  action: string
): boolean {
  // Many nested conditionals = high cyclomatic complexity
  if (!user.isActive) {
    return false;
  }
  
  if (user.role === 'admin') {
    return true;
  }
  
  if (user.role === 'editor') {
    if (action === 'read') {
      return true;
    }
    if (action === 'write') {
      if (resource === 'posts' || resource === 'pages') {
        return true;
      }
    }
    if (action === 'delete') {
      if (resource === 'drafts') {
        return true;
      }
    }
  }
  
  if (user.role === 'viewer') {
    if (action === 'read') {
      return true;
    }
  }
  
  if (user.role === 'moderator') {
    if (action === 'read' || action === 'write') {
      return true;
    }
    if (action === 'delete') {
      if (resource === 'comments' || resource === 'spam') {
        return true;
      }
    }
  }
  
  if (user.permissions.includes(`${resource}:${action}`)) {
    return true;
  }
  
  return false;
}

/**
 * High cognitive complexity - deeply nested logic
 */
export function processOrderWithDiscounts(
  order: { items: Array<{ price: number; category: string; quantity: number }> },
  customer: { vip: boolean; loyaltyPoints: number; region: string },
  promotions: Array<{ code: string; discount: number; minAmount: number }>
): number {
  let total = 0;
  let discount = 0;
  
  // Deep nesting = high cognitive complexity
  for (const item of order.items) {
    total += item.price * item.quantity;
    
    if (customer.vip) {
      if (item.category === 'electronics') {
        if (item.price > 1000) {
          if (customer.loyaltyPoints > 500) {
            discount += item.price * 0.15;
          } else {
            discount += item.price * 0.10;
          }
        } else {
          discount += item.price * 0.05;
        }
      } else if (item.category === 'clothing') {
        if (customer.region === 'US') {
          discount += item.price * 0.20;
        } else {
          discount += item.price * 0.15;
        }
      }
    } else {
      if (item.category === 'electronics') {
        if (item.price > 500) {
          discount += item.price * 0.05;
        }
      }
    }
  }
  
  for (const promo of promotions) {
    if (total >= promo.minAmount) {
      if (promo.code === 'SUMMER20') {
        discount += total * promo.discount;
      } else if (promo.code === 'WINTER25') {
        if (customer.vip) {
          discount += total * (promo.discount + 0.05);
        } else {
          discount += total * promo.discount;
        }
      }
    }
  }
  
  return Math.max(0, total - discount);
}

/**
 * High Halstead complexity - many unique operators and operands
 */
export function calculateComplexMetrics(
  data: number[],
  config: { smoothing: boolean; normalization: string; weights: number[] }
): {
  mean: number;
  median: number;
  stdDev: number;
  weighted: number;
  normalized: number;
} {
  // Lots of operators and complex expressions = high Halstead
  const sum = data.reduce((acc, val) => acc + val, 0);
  const mean = sum / data.length;
  const sorted = [...data].sort((a, b) => a - b);
  const median = data.length % 2 === 0
    ? (sorted[data.length / 2 - 1] + sorted[data.length / 2]) / 2
    : sorted[Math.floor(data.length / 2)];
  
  const squaredDiffs = data.map(val => Math.pow(val - mean, 2));
  const variance = squaredDiffs.reduce((acc, val) => acc + val, 0) / data.length;
  const stdDev = Math.sqrt(variance);
  
  const weighted = config.weights.length > 0
    ? data.reduce((acc, val, idx) => acc + (val * (config.weights[idx] || 1)), 0) / 
      config.weights.reduce((acc, w) => acc + w, 0)
    : mean;
  
  let normalized = mean;
  if (config.normalization === 'minmax') {
    const min = Math.min(...data);
    const max = Math.max(...data);
    normalized = (mean - min) / (max - min);
  } else if (config.normalization === 'zscore') {
    normalized = (mean - mean) / stdDev;
  } else if (config.normalization === 'robust') {
    const q1 = sorted[Math.floor(data.length * 0.25)];
    const q3 = sorted[Math.floor(data.length * 0.75)];
    const iqr = q3 - q1;
    normalized = (mean - median) / iqr;
  }
  
  if (config.smoothing) {
    const smoothingFactor = 0.3;
    normalized = normalized * (1 - smoothingFactor) + mean * smoothingFactor;
  }
  
  return { mean, median, stdDev, weighted, normalized };
}

/**
 * Another cyclomatic complexity example - switch with nested conditions
 */
export function routeRequest(
  request: { method: string; path: string; auth?: string },
  context: { env: string; features: Set<string> }
): string {
  // Switch with many branches and nested conditions
  switch (request.method) {
    case 'GET':
      if (request.path.startsWith('/api/users')) {
        if (context.features.has('users_v2')) {
          return 'UsersControllerV2.list';
        } else {
          return 'UsersController.list';
        }
      } else if (request.path.startsWith('/api/posts')) {
        if (context.env === 'production') {
          if (context.features.has('posts_cache')) {
            return 'PostsController.cachedList';
          } else {
            return 'PostsController.list';
          }
        } else {
          return 'PostsController.list';
        }
      } else if (request.path.startsWith('/api/comments')) {
        return 'CommentsController.list';
      }
      break;
    
    case 'POST':
      if (!request.auth) {
        return 'ErrorController.unauthorized';
      }
      if (request.path.startsWith('/api/users')) {
        if (context.features.has('registration')) {
          return 'UsersController.create';
        } else {
          return 'ErrorController.featureDisabled';
        }
      } else if (request.path.startsWith('/api/posts')) {
        return 'PostsController.create';
      }
      break;
    
    case 'PUT':
      if (!request.auth) {
        return 'ErrorController.unauthorized';
      }
      if (request.path.startsWith('/api/users')) {
        return 'UsersController.update';
      } else if (request.path.startsWith('/api/posts')) {
        if (context.env === 'production') {
          if (context.features.has('async_updates')) {
            return 'PostsController.asyncUpdate';
          } else {
            return 'PostsController.update';
          }
        } else {
          return 'PostsController.update';
        }
      }
      break;
    
    case 'DELETE':
      if (!request.auth) {
        return 'ErrorController.unauthorized';
      }
      if (request.path.startsWith('/api/users')) {
        return 'UsersController.delete';
      } else if (request.path.startsWith('/api/posts')) {
        return 'PostsController.delete';
      }
      break;
    
    default:
      return 'ErrorController.methodNotAllowed';
  }
  
  return 'ErrorController.notFound';
}
