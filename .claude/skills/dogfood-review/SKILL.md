---
name: dogfood-review
description: Evaluate Lien Review's AI review quality by creating a PR with known violations, waiting for the automated review, then scoring output against ground truth.
disable-model-invocation: true
user-invocable: true
allowed-tools: Bash(git *), Bash(gh *), Bash(sleep *), Bash(date *), Read, Write, Glob, Grep
---

# Dogfood Lien Review Quality

Evaluate the Lien Review AI code review system by creating a PR with **known complexity violations**, waiting for the automated review, then scoring the output against a ground truth manifest.

## Phase 1: Setup & Generate Test Files

1. Generate a timestamp for the branch name:

```bash
date +%Y%m%d-%H%M%S
```

2. Create branch from `main`:

```bash
git checkout main && git pull origin main
git checkout -b dogfood-review/<timestamp>
```

3. Create the `_dogfood-review/` directory and write all 5 test files (see "Test Files" section below).

4. Commit and push:

```bash
git add _dogfood-review/
git commit -m "test: dogfood-review evaluation files"
git push -u origin dogfood-review/<timestamp>
```

## Phase 2: Open PR

Create the PR targeting `main`:

```bash
gh pr create \
  --title "[Dogfood] Lien Review Quality Evaluation <timestamp>" \
  --body "Automated dogfood evaluation of Lien Review. This PR contains intentional complexity violations to test review detection quality. **Do not merge.**"
```

Capture the PR number from the output.

## Phase 3: Wait for Review

Poll the workflow status every 30 seconds, timing out after 10 minutes:

```bash
gh run list --branch dogfood-review/<timestamp> --workflow lien-review.yml --json status,conclusion,databaseId --limit 1
```

- If `status` is `completed`, proceed to Phase 4 regardless of `conclusion` — the review is advisory by default (`fail-on: never`), so the job stays green whenever the action *ran*; findings surface as annotations/comments/description either way. A `failure` conclusion means the action crashed, not that violations were found — note it but still try to collect partial results.
- If 10 minutes elapse with no completion, note the timeout and proceed to Phase 4.

## Phase 4: Fetch & Evaluate

Lien Review posts no Checks-API check run of its own — the workflow job itself is the single status check, and findings surface three ways: **workflow annotations** (attached to that job's auto-created check run), **inline PR review comments** (bug findings only — complexity findings never get one), and the **PR description** (aggregate complexity counts + architectural observations, if any). There is no separate `<!-- lien-ai-review -->`-marked summary comment in the current engine — that marker only appears in unused legacy code paths (`buildNoViolationsMessage`/`buildLineSummaryComment` in `packages/review/src/prompt.ts`, dead since the plugin architecture landed).

### 4a. Fetch workflow annotations (primary source for complexity findings)

```bash
sha=$(gh pr view <pr> --json headRefOid -q .headRefOid)
gh api repos/getlien/lien/commits/$sha/check-runs --jq '.check_runs[] | {id, name, conclusion}'
# Find the run for the "review" job (workflow name "Lien Review"), then:
gh api repos/getlien/lien/check-runs/<check-run-id>/annotations --paginate
```

Each annotation carries `path`, `start_line`, `annotation_level` (`failure`→error, `warning`→warning, `notice`→info), `title`, and `message`. The `title` format is `{symbolName} — {metricLabel}: {value} (threshold: X)` (see `packages/review/src/plugins/complexity.ts`), where `metricLabel` is the human-readable label from `getMetricLabel` in `packages/review/src/prompt.ts` — `test paths` (cyclomatic), `mental load` (cognitive), `time to understand` (halstead_effort), `estimated bugs` (halstead_bugs) — never the raw metric token, so map labels back to metric types when scoring. There is no dedup marker on annotations — match by `path` + `start_line` against the Ground Truth Manifest.

**Caveat — read before scoring Metric Accuracy:** the engine posts only the single *worst* metric per function (`worstPerFunction()` in `packages/review/src/plugins/complexity.ts`), never all of them. A function the manifest lists under 3-4 metrics will produce exactly **one** annotation. Score Metric Accuracy against the worst-metric-per-symbol subset of the manifest, not the full multi-metric list — treat the other expected metrics for that symbol as "not independently observable," not as misses.

### 4b. Fetch inline PR review comments (agent-review bug findings only)

```bash
gh api repos/getlien/lien/pulls/<pr>/comments --paginate
```

These fixtures are pure complexity/architecture bait with no logic bugs, so expect zero comments here — the agent-review plugin (which owns inline comments) targets `logic_error`/`error_handling`/`breaking_change`-style findings, not complexity. If any appear, extract the dedup marker: current format is `<!-- lien-plugin:{pluginId}:{filepath}::{line}::{category} -->` (`PLUGIN_MARKER_PREFIX` in `packages/review/src/github-api.ts`, matched by `extractPluginCommentKey` in `packages/review/src/engine.ts`), default `pluginId` is `agent-review` — this path has no legacy fallback. Separately, the *complexity summary comment* dedups via `<!-- lien-review:... -->` (`COMMENT_MARKER_PREFIX`), whose `parseCommentMarker()` still recognizes a legacy `<!-- veille:{filepath}::{symbolName} -->` prefix as a fallback that is never freshly emitted — treat any veille hit there as pre-existing, not new.

### 4c. Fetch the PR description

```bash
gh pr view <pr> --json body -q .body
```

Contains an aggregate complexity table (violation **count** per metric type, no per-symbol detail — see `buildMetricTable` in `packages/review/src/prompt.ts`) and, only if the agent-review plugin's `architectural` category fired, a `<details><summary>🏗️ Architectural</summary>` block with a Scope/Observation/Suggestion table. Use this block for the DRY/SRP/KISS/coupling scoring dimension.

### 4d. Score against ground truth

Compare detected violations (4a annotations, keyed by `path::startLine`, cross-referenced against source to identify the symbol) against the **Ground Truth Manifest** below. Calculate:

| Dimension | Formula |
|-----------|---------|
| Detection Rate | `detected_symbols / expected_symbols * 100%` |
| Metric Accuracy | `correct_metric_types / worst_metric_per_symbol_count * 100%` (see 4a caveat) |
| Severity Accuracy | `correct_severities / total_expected_severities * 100%` |
| Architectural Detection | Check the PR description's Architectural block (4c) for mentions of: DRY, SRP/single responsibility, KISS, coupling/cohesion |
| Comment Quality | 1-5 scale per annotation/comment: specific? actionable? correct? |
| False Positives | Count of annotations/comments on symbols NOT in ground truth |
| Overall Grade | A (>=80% detect, >=60% arch) / B (>=60% detect, >=40% arch) / C (>=40% detect) / D (>=20% detect) / F (<20% detect) |

### 4e. Write report

Write the full evaluation report to `.wip/lien-review-dogfood-report.md` (see "Report Format" section below).

## Phase 5: Cleanup

Close the PR and delete branches:

```bash
gh pr close <number> --comment "Dogfood evaluation complete. See .wip/lien-review-dogfood-report.md for results."
git push origin --delete dogfood-review/<timestamp>
git checkout main
git branch -D dogfood-review/<timestamp>
```

---

## Test Files

Write these 5 files into `_dogfood-review/`. Each is designed to trigger Lien's hardcoded complexity thresholds:
- **Cyclomatic (testPaths):** warning >= 15, error >= 30
- **Cognitive (mentalLoad):** warning >= 15, error >= 30
- **Halstead effort (timeToUnderstandMinutes):** warning >= 60min, error >= 120min
- **Halstead bugs (estimatedBugs):** warning >= 1.5, error >= 3.0

### File 1: `_dogfood-review/high-complexity.ts`

A massive request router with 35+ branches and deep nesting. Should trigger **error** on both cyclomatic and cognitive.

```typescript
// High-complexity request router — intentional violation for dogfood testing.
// Expected: cyclomatic error (>30), cognitive error (>30), halstead_effort warning

interface Request {
  method: string;
  path: string;
  body?: Record<string, unknown>;
  headers?: Record<string, string>;
  query?: Record<string, string>;
}
interface Response {
  status: number;
  body: unknown;
}

export function handleRequest(req: Request): Response {
  if (req.method === 'GET') {
    if (req.path === '/users') {
      if (req.query?.role === 'admin') {
        if (req.query?.active === 'true') {
          return { status: 200, body: { users: [], filter: 'active-admins' } };
        } else if (req.query?.active === 'false') {
          return { status: 200, body: { users: [], filter: 'inactive-admins' } };
        } else {
          return { status: 200, body: { users: [], filter: 'all-admins' } };
        }
      } else if (req.query?.role === 'editor') {
        if (req.query?.department) {
          return { status: 200, body: { users: [], filter: 'dept-editors' } };
        }
        return { status: 200, body: { users: [], filter: 'editors' } };
      } else if (req.query?.search) {
        if (req.query.search.length < 3) {
          return { status: 400, body: { error: 'Search query too short' } };
        }
        return { status: 200, body: { users: [], search: req.query.search } };
      } else {
        return { status: 200, body: { users: [] } };
      }
    } else if (req.path === '/posts') {
      if (req.query?.category) {
        if (req.query?.sort === 'date') {
          return { status: 200, body: { posts: [], sort: 'date' } };
        } else if (req.query?.sort === 'popular') {
          return { status: 200, body: { posts: [], sort: 'popular' } };
        }
        return { status: 200, body: { posts: [], category: req.query.category } };
      } else if (req.query?.author) {
        return { status: 200, body: { posts: [], author: req.query.author } };
      }
      return { status: 200, body: { posts: [] } };
    } else if (req.path === '/comments') {
      if (req.query?.postId) {
        if (req.query?.threaded === 'true') {
          return { status: 200, body: { comments: [], threaded: true } };
        }
        return { status: 200, body: { comments: [] } };
      }
      return { status: 400, body: { error: 'postId required' } };
    } else if (req.path === '/tags') {
      return { status: 200, body: { tags: [] } };
    } else if (req.path === '/health') {
      return { status: 200, body: { ok: true } };
    } else {
      return { status: 404, body: { error: 'Not found' } };
    }
  } else if (req.method === 'POST') {
    if (req.path === '/users') {
      if (!req.body?.email) {
        return { status: 400, body: { error: 'Email required' } };
      }
      if (!req.body?.name) {
        return { status: 400, body: { error: 'Name required' } };
      }
      if (req.body?.role === 'admin') {
        if (!req.headers?.['x-admin-key']) {
          return { status: 403, body: { error: 'Admin key required' } };
        }
      }
      return { status: 201, body: { created: true } };
    } else if (req.path === '/posts') {
      if (!req.body?.title || !req.body?.content) {
        return { status: 400, body: { error: 'Title and content required' } };
      }
      if (typeof req.body.title !== 'string' || req.body.title.length > 200) {
        return { status: 400, body: { error: 'Invalid title' } };
      }
      return { status: 201, body: { created: true } };
    } else if (req.path === '/comments') {
      if (!req.body?.text || !req.body?.postId) {
        return { status: 400, body: { error: 'Text and postId required' } };
      }
      return { status: 201, body: { created: true } };
    } else {
      return { status: 404, body: { error: 'Not found' } };
    }
  } else if (req.method === 'PUT') {
    if (req.path.startsWith('/users/')) {
      if (!req.body) {
        return { status: 400, body: { error: 'Body required' } };
      }
      return { status: 200, body: { updated: true } };
    } else if (req.path.startsWith('/posts/')) {
      if (!req.body?.title && !req.body?.content) {
        return { status: 400, body: { error: 'Nothing to update' } };
      }
      return { status: 200, body: { updated: true } };
    }
    return { status: 404, body: { error: 'Not found' } };
  } else if (req.method === 'DELETE') {
    if (req.path.startsWith('/users/')) {
      if (!req.headers?.['x-admin-key']) {
        return { status: 403, body: { error: 'Admin key required' } };
      }
      return { status: 204, body: null };
    } else if (req.path.startsWith('/posts/')) {
      return { status: 204, body: null };
    }
    return { status: 404, body: { error: 'Not found' } };
  } else if (req.method === 'PATCH') {
    if (req.path.startsWith('/users/')) {
      return { status: 200, body: { patched: true } };
    }
    return { status: 404, body: { error: 'Not found' } };
  } else {
    return { status: 405, body: { error: 'Method not allowed' } };
  }
}
```

### File 2: `_dogfood-review/dry-violations.ts`

Three copy-pasted functions that filter, sort, and format data — identical structure, different field names. Should trigger **warning** on each function (cyclomatic ~15-20).

```typescript
// DRY violations — three copy-pasted filter/sort/format pipelines.
// Expected: cyclomatic warning on each, architectural DRY observation

interface User {
  id: number;
  name: string;
  email: string;
  role: string;
  active: boolean;
  score: number;
  department: string;
  createdAt: Date;
}

interface Product {
  id: number;
  title: string;
  sku: string;
  category: string;
  inStock: boolean;
  price: number;
  vendor: string;
  listedAt: Date;
}

interface Order {
  id: number;
  customer: string;
  reference: string;
  type: string;
  fulfilled: boolean;
  total: number;
  region: string;
  orderedAt: Date;
}

export function filterSortFormatUsers(
  users: User[],
  filters: { role?: string; active?: boolean; minScore?: number; department?: string },
  sortBy: string,
  sortOrder: 'asc' | 'desc',
): string[] {
  let result = [...users];

  if (filters.role) {
    result = result.filter(u => u.role === filters.role);
  }
  if (filters.active !== undefined) {
    result = result.filter(u => u.active === filters.active);
  }
  if (filters.minScore !== undefined) {
    result = result.filter(u => u.score >= filters.minScore!);
  }
  if (filters.department) {
    result = result.filter(u => u.department === filters.department);
  }

  if (sortBy === 'name') {
    result.sort((a, b) => sortOrder === 'asc' ? a.name.localeCompare(b.name) : b.name.localeCompare(a.name));
  } else if (sortBy === 'score') {
    result.sort((a, b) => sortOrder === 'asc' ? a.score - b.score : b.score - a.score);
  } else if (sortBy === 'createdAt') {
    result.sort((a, b) => sortOrder === 'asc' ? a.createdAt.getTime() - b.createdAt.getTime() : b.createdAt.getTime() - a.createdAt.getTime());
  } else if (sortBy === 'email') {
    result.sort((a, b) => sortOrder === 'asc' ? a.email.localeCompare(b.email) : b.email.localeCompare(a.email));
  } else if (sortBy === 'department') {
    result.sort((a, b) => sortOrder === 'asc' ? a.department.localeCompare(b.department) : b.department.localeCompare(a.department));
  }

  return result.map(u => {
    if (u.active) {
      return `[ACTIVE] ${u.name} (${u.role}) - ${u.department} - Score: ${u.score}`;
    } else {
      return `[INACTIVE] ${u.name} (${u.role}) - ${u.department}`;
    }
  });
}

export function filterSortFormatProducts(
  products: Product[],
  filters: { category?: string; inStock?: boolean; minPrice?: number; vendor?: string },
  sortBy: string,
  sortOrder: 'asc' | 'desc',
): string[] {
  let result = [...products];

  if (filters.category) {
    result = result.filter(p => p.category === filters.category);
  }
  if (filters.inStock !== undefined) {
    result = result.filter(p => p.inStock === filters.inStock);
  }
  if (filters.minPrice !== undefined) {
    result = result.filter(p => p.price >= filters.minPrice!);
  }
  if (filters.vendor) {
    result = result.filter(p => p.vendor === filters.vendor);
  }

  if (sortBy === 'title') {
    result.sort((a, b) => sortOrder === 'asc' ? a.title.localeCompare(b.title) : b.title.localeCompare(a.title));
  } else if (sortBy === 'price') {
    result.sort((a, b) => sortOrder === 'asc' ? a.price - b.price : b.price - a.price);
  } else if (sortBy === 'listedAt') {
    result.sort((a, b) => sortOrder === 'asc' ? a.listedAt.getTime() - b.listedAt.getTime() : b.listedAt.getTime() - a.listedAt.getTime());
  } else if (sortBy === 'sku') {
    result.sort((a, b) => sortOrder === 'asc' ? a.sku.localeCompare(b.sku) : b.sku.localeCompare(a.sku));
  } else if (sortBy === 'vendor') {
    result.sort((a, b) => sortOrder === 'asc' ? a.vendor.localeCompare(b.vendor) : b.vendor.localeCompare(a.vendor));
  }

  return result.map(p => {
    if (p.inStock) {
      return `[IN STOCK] ${p.title} (${p.category}) - ${p.vendor} - $${p.price.toFixed(2)}`;
    } else {
      return `[OUT OF STOCK] ${p.title} (${p.category}) - ${p.vendor}`;
    }
  });
}

export function filterSortFormatOrders(
  orders: Order[],
  filters: { type?: string; fulfilled?: boolean; minTotal?: number; region?: string },
  sortBy: string,
  sortOrder: 'asc' | 'desc',
): string[] {
  let result = [...orders];

  if (filters.type) {
    result = result.filter(o => o.type === filters.type);
  }
  if (filters.fulfilled !== undefined) {
    result = result.filter(o => o.fulfilled === filters.fulfilled);
  }
  if (filters.minTotal !== undefined) {
    result = result.filter(o => o.total >= filters.minTotal!);
  }
  if (filters.region) {
    result = result.filter(o => o.region === filters.region);
  }

  if (sortBy === 'customer') {
    result.sort((a, b) => sortOrder === 'asc' ? a.customer.localeCompare(b.customer) : b.customer.localeCompare(a.customer));
  } else if (sortBy === 'total') {
    result.sort((a, b) => sortOrder === 'asc' ? a.total - b.total : b.total - a.total);
  } else if (sortBy === 'orderedAt') {
    result.sort((a, b) => sortOrder === 'asc' ? a.orderedAt.getTime() - b.orderedAt.getTime() : b.orderedAt.getTime() - a.orderedAt.getTime());
  } else if (sortBy === 'reference') {
    result.sort((a, b) => sortOrder === 'asc' ? a.reference.localeCompare(b.reference) : b.reference.localeCompare(a.reference));
  } else if (sortBy === 'region') {
    result.sort((a, b) => sortOrder === 'asc' ? a.region.localeCompare(b.region) : b.region.localeCompare(a.region));
  }

  return result.map(o => {
    if (o.fulfilled) {
      return `[FULFILLED] ${o.customer} (${o.type}) - ${o.region} - $${o.total.toFixed(2)}`;
    } else {
      return `[PENDING] ${o.customer} (${o.type}) - ${o.region}`;
    }
  });
}
```

### File 3: `_dogfood-review/solid-violations.ts`

God class handling events, notifications, caching, and metrics — violates SRP. The `processEvent` method uses a massive switch with deep nesting. Should trigger **error** on `processEvent`, **warning** on `sendNotification`.

```typescript
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
        this.cache.set(`user:${event.userId}`, { ...cached as object, ...event.payload });
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
          this.sendNotification('Critical order cancellation', event.userId, ['email', 'sms', 'slack']);
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
          this.sendNotification('CRITICAL system alert', event.userId, ['email', 'sms', 'slack', 'webhook']);
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
```

### File 4: `_dogfood-review/kiss-violations.ts`

Over-engineered factory/strategy/chain pattern for 6 simple string operations. Should trigger **warning** on the factory function's switch statement. Architectural observation: KISS violation.

```typescript
// KISS violations — over-engineered factory pattern for trivial string ops.
// Expected: cyclomatic warning on createTransformer, architectural KISS observation

interface StringTransformer {
  name: string;
  transform(input: string): string;
  validate(input: string): boolean;
  getDescription(): string;
}

interface TransformerConfig {
  type: string;
  options?: Record<string, unknown>;
  fallback?: string;
  chainWith?: string;
  priority?: number;
}

class UpperCaseTransformer implements StringTransformer {
  name = 'uppercase';
  transform(input: string): string { return input.toUpperCase(); }
  validate(input: string): boolean { return typeof input === 'string' && input.length > 0; }
  getDescription(): string { return 'Converts text to UPPER CASE'; }
}

class LowerCaseTransformer implements StringTransformer {
  name = 'lowercase';
  transform(input: string): string { return input.toLowerCase(); }
  validate(input: string): boolean { return typeof input === 'string' && input.length > 0; }
  getDescription(): string { return 'Converts text to lower case'; }
}

class TrimTransformer implements StringTransformer {
  name = 'trim';
  transform(input: string): string { return input.trim(); }
  validate(input: string): boolean { return typeof input === 'string'; }
  getDescription(): string { return 'Removes leading and trailing whitespace'; }
}

class ReverseTransformer implements StringTransformer {
  name = 'reverse';
  transform(input: string): string { return input.split('').reverse().join(''); }
  validate(input: string): boolean { return typeof input === 'string' && input.length > 0; }
  getDescription(): string { return 'Reverses the string'; }
}

class SlugifyTransformer implements StringTransformer {
  name = 'slugify';
  transform(input: string): string { return input.toLowerCase().replace(/\s+/g, '-').replace(/[^a-z0-9-]/g, ''); }
  validate(input: string): boolean { return typeof input === 'string' && input.length > 0; }
  getDescription(): string { return 'Converts text to URL slug'; }
}

class CamelCaseTransformer implements StringTransformer {
  name = 'camelCase';
  transform(input: string): string {
    return input.toLowerCase().replace(/[-_\s]+(.)?/g, (_, c) => c ? c.toUpperCase() : '');
  }
  validate(input: string): boolean { return typeof input === 'string' && input.length > 0; }
  getDescription(): string { return 'Converts text to camelCase'; }
}

export function createTransformer(config: TransformerConfig): StringTransformer {
  let transformer: StringTransformer;

  if (config.type === 'uppercase') {
    transformer = new UpperCaseTransformer();
  } else if (config.type === 'lowercase') {
    transformer = new LowerCaseTransformer();
  } else if (config.type === 'trim') {
    transformer = new TrimTransformer();
  } else if (config.type === 'reverse') {
    transformer = new ReverseTransformer();
  } else if (config.type === 'slugify') {
    transformer = new SlugifyTransformer();
  } else if (config.type === 'camelCase') {
    transformer = new CamelCaseTransformer();
  } else {
    if (config.fallback) {
      if (config.fallback === 'uppercase') {
        transformer = new UpperCaseTransformer();
      } else if (config.fallback === 'lowercase') {
        transformer = new LowerCaseTransformer();
      } else if (config.fallback === 'trim') {
        transformer = new TrimTransformer();
      } else {
        transformer = new LowerCaseTransformer();
      }
    } else {
      throw new Error(`Unknown transformer type: ${config.type}`);
    }
  }

  if (config.chainWith) {
    const chained = createTransformer({ type: config.chainWith });
    const base = transformer;
    return {
      name: `${base.name}+${chained.name}`,
      transform: (input: string) => chained.transform(base.transform(input)),
      validate: (input: string) => base.validate(input),
      getDescription: () => `${base.getDescription()} then ${chained.getDescription()}`,
    };
  }

  return transformer;
}

export function processStrings(inputs: string[], configs: TransformerConfig[]): string[] {
  const transformers = configs.map(c => createTransformer(c));
  return inputs.map(input => {
    let result = input;
    for (const t of transformers) {
      if (t.validate(result)) {
        result = t.transform(result);
      }
    }
    return result;
  });
}
```

### File 5: `_dogfood-review/coupling-smells.ts`

Monolithic pipeline mixing parsing, validation, transformation, and output into one function via mutable state. Should trigger **error** on cyclomatic, cognitive, and halstead metrics.

```typescript
// Coupling smells — monolithic pipeline with mixed responsibilities and mutable state.
// Expected: cyclomatic error, cognitive error, halstead_effort error, halstead_bugs warning,
//           architectural coupling/cohesion observation

interface RawRecord {
  id?: string;
  data?: string;
  type?: string;
  format?: string;
  tags?: string[];
  metadata?: Record<string, unknown>;
  source?: string;
  priority?: number;
}

interface ProcessedRecord {
  id: string;
  normalizedData: string;
  type: string;
  score: number;
  tags: string[];
  warnings: string[];
  outputFormat: string;
}

export function processRecordPipeline(
  records: RawRecord[],
  config: {
    allowedTypes: string[];
    maxRecords: number;
    scoreThreshold: number;
    enableDedup: boolean;
    outputFormat: 'json' | 'csv' | 'xml';
    tagFilters?: string[];
    sourceWeights?: Record<string, number>;
    priorityBoost?: boolean;
  },
): { processed: ProcessedRecord[]; errors: string[]; stats: Record<string, number> } {
  const processed: ProcessedRecord[] = [];
  const errors: string[] = [];
  const stats: Record<string, number> = { total: 0, valid: 0, invalid: 0, deduped: 0, filtered: 0, scored: 0 };
  const seenIds = new Set<string>();

  for (let i = 0; i < records.length && processed.length < config.maxRecords; i++) {
    const record = records[i];
    stats.total++;

    // Phase 1: Parsing & basic validation
    if (!record.id) {
      errors.push(`Record ${i}: missing id`);
      stats.invalid++;
      continue;
    }
    if (!record.data) {
      errors.push(`Record ${record.id}: missing data`);
      stats.invalid++;
      continue;
    }
    if (!record.type) {
      errors.push(`Record ${record.id}: missing type`);
      stats.invalid++;
      continue;
    }
    if (!config.allowedTypes.includes(record.type)) {
      errors.push(`Record ${record.id}: disallowed type '${record.type}'`);
      stats.invalid++;
      continue;
    }

    // Phase 2: Dedup
    if (config.enableDedup) {
      if (seenIds.has(record.id)) {
        stats.deduped++;
        continue;
      }
      seenIds.add(record.id);
    }

    // Phase 3: Tag filtering
    if (config.tagFilters && config.tagFilters.length > 0) {
      if (!record.tags || record.tags.length === 0) {
        stats.filtered++;
        continue;
      }
      const hasMatchingTag = record.tags.some(t => config.tagFilters!.includes(t));
      if (!hasMatchingTag) {
        stats.filtered++;
        continue;
      }
    }

    // Phase 4: Data normalization
    let normalizedData = record.data.trim();
    if (record.format === 'html') {
      normalizedData = normalizedData.replace(/<[^>]*>/g, '');
    } else if (record.format === 'markdown') {
      normalizedData = normalizedData.replace(/[#*_~`]/g, '');
    } else if (record.format === 'csv') {
      normalizedData = normalizedData.replace(/,/g, ' | ');
    }
    if (normalizedData.length > 1000) {
      normalizedData = normalizedData.substring(0, 1000) + '...';
    }

    // Phase 5: Scoring
    let score = 0;
    if (record.source && config.sourceWeights) {
      if (config.sourceWeights[record.source]) {
        score += config.sourceWeights[record.source];
      } else if (config.sourceWeights['default']) {
        score += config.sourceWeights['default'];
      } else {
        score += 1;
      }
    } else {
      score += 1;
    }

    if (record.priority !== undefined) {
      if (config.priorityBoost) {
        if (record.priority >= 8) {
          score *= 3;
        } else if (record.priority >= 5) {
          score *= 2;
        } else if (record.priority >= 3) {
          score *= 1.5;
        }
      }
    }

    if (record.tags && record.tags.length > 3) {
      score += record.tags.length * 0.5;
    }

    if (record.metadata) {
      if (record.metadata.verified) {
        score += 5;
      }
      if (record.metadata.featured) {
        score += 10;
      }
      if (record.metadata.sponsored) {
        score -= 2;
      }
    }

    if (score < config.scoreThreshold) {
      stats.filtered++;
      continue;
    }
    stats.scored++;

    // Phase 6: Build output
    const warnings: string[] = [];
    if (normalizedData.length < 10) {
      warnings.push('Very short content');
    }
    if (!record.tags || record.tags.length === 0) {
      warnings.push('No tags');
    }
    if (record.priority !== undefined && record.priority < 3) {
      warnings.push('Low priority');
    }

    let outputFormat = config.outputFormat;
    if (record.metadata?.preferredFormat) {
      if (record.metadata.preferredFormat === 'json' || record.metadata.preferredFormat === 'csv' || record.metadata.preferredFormat === 'xml') {
        outputFormat = record.metadata.preferredFormat as 'json' | 'csv' | 'xml';
      }
    }

    processed.push({
      id: record.id,
      normalizedData,
      type: record.type,
      score,
      tags: record.tags || [],
      warnings,
      outputFormat,
    });

    stats.valid++;
  }

  return { processed, errors, stats };
}
```

---

## Ground Truth Manifest

This is the complete set of expected violations. Use this to score the review output.

### Expected Symbols & Metrics

| File | Symbol | Metric | Expected Severity | Notes |
|------|--------|--------|-------------------|-------|
| `_dogfood-review/high-complexity.ts` | `handleRequest` | cyclomatic | error | 35+ branches |
| `_dogfood-review/high-complexity.ts` | `handleRequest` | cognitive | error | Deep nesting |
| `_dogfood-review/dry-violations.ts` | `filterSortFormatUsers` | cyclomatic | warning | ~15-20 branches |
| `_dogfood-review/dry-violations.ts` | `filterSortFormatProducts` | cyclomatic | warning | ~15-20 branches |
| `_dogfood-review/dry-violations.ts` | `filterSortFormatOrders` | cyclomatic | warning | ~15-20 branches |
| `_dogfood-review/solid-violations.ts` | `processEvent` | cyclomatic | error | 30+ branches in switch |
| `_dogfood-review/solid-violations.ts` | `processEvent` | cognitive | error | Deep switch nesting |
| `_dogfood-review/solid-violations.ts` | `sendNotification` | cyclomatic | warning | ~15 branches |
| `_dogfood-review/kiss-violations.ts` | `createTransformer` | cyclomatic | warning | 15+ if-else branches |
| `_dogfood-review/coupling-smells.ts` | `processRecordPipeline` | cyclomatic | error | 30+ branches |
| `_dogfood-review/coupling-smells.ts` | `processRecordPipeline` | cognitive | error | Deep nesting across phases |
| `_dogfood-review/coupling-smells.ts` | `processRecordPipeline` | halstead_effort | warning+ | Long function, many operands |
| `_dogfood-review/coupling-smells.ts` | `processRecordPipeline` | halstead_bugs | warning+ | High volume |

**Total expected symbols:** 8 unique (`handleRequest`, `filterSortFormatUsers`, `filterSortFormatProducts`, `filterSortFormatOrders`, `processEvent`, `sendNotification`, `createTransformer`, `processRecordPipeline`)

**Total expected metric violations:** ~13-15 (some symbols trigger multiple metrics) — but per the 4a caveat, the engine only ever *surfaces* one (the worst) per symbol. `processEvent` and `processRecordPipeline` each list 2+ metrics above; expect exactly one annotation for each in practice.

### Expected Architectural Observations

Only surfaces if the agent-review plugin's `architectural` category fires (requires `OPENROUTER_API_KEY`; it's an LLM judgment call, not an AST metric, so it's not guaranteed to fire on every run). Check the PR description's `<details><summary>🏗️ Architectural</summary>` block for:

| Observation | Source File |
|-------------|-------------|
| DRY / duplication / repeated pattern | `dry-violations.ts` |
| SRP / single responsibility / god class | `solid-violations.ts` |
| KISS / over-engineering / unnecessary abstraction | `kiss-violations.ts` |
| Coupling / cohesion / mixed responsibilities | `coupling-smells.ts` |

---

## Report Format

Write to `.wip/lien-review-dogfood-report.md`:

```markdown
# Lien Review Dogfood Evaluation Report

**Date:** <timestamp>
**PR:** #<number>
**Branch:** dogfood-review/<timestamp>
**Workflow Status:** success | failure | timeout

## Summary Scorecard

| Dimension | Score | Details |
|-----------|-------|---------|
| Detection Rate | X/8 symbols (Y%) | List detected/missed |
| Metric Accuracy | X/N metrics (Y%) | Correct metric types (worst-per-symbol only, see manifest note) |
| Severity Accuracy | X/N severities (Y%) | Correct severity levels |
| Architectural Detection | X/4 observations (Y%) | Which observed |
| Comment Quality | X/5 average | See per-file details |
| False Positives | N | Unexpected annotations/comments |
| **Overall Grade** | **A/B/C/D/F** | |

## Per-File Results

### high-complexity.ts
- `handleRequest`:
  - Detected: yes/no
  - Metric reported: [worst metric only]
  - Expected metrics: cyclomatic error, cognitive error
  - Comment quality (1-5): X
  - Notes: ...

### dry-violations.ts
(repeat for each symbol)

### solid-violations.ts
(repeat for each symbol)

### kiss-violations.ts
(repeat for each symbol)

### coupling-smells.ts
(repeat for each symbol)

## Architectural Review Assessment

| Observation | Detected | Quality |
|-------------|----------|---------|
| DRY | yes/no | notes |
| SRP | yes/no | notes |
| KISS | yes/no | notes |
| Coupling | yes/no | notes |

## Best & Worst Findings

### Best Finding
> (quote the most useful, specific, actionable annotation/comment)

Why it's good: ...

### Worst Finding
> (quote the least useful or most generic annotation/comment)

Why it's weak: ...

## Improvement Recommendations

1. ...
2. ...
3. ...

<details>
<summary>Raw Data</summary>

### Workflow Annotations (raw)
(paste the check-run annotations JSON)

### PR Description (raw)
(paste the PR body)

### Inline Comments (raw, if any)
(paste each comment with its marker)

</details>
```
