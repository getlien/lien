import type { Logger } from '@liendev/review';

/**
 * Check if an org/user is allowed to use the app.
 * If allowedOrgIds is empty, all orgs are allowed (open beta mode).
 */
export function isOrgAllowed(orgId: number, allowedOrgIds: number[], logger: Logger): boolean {
  if (allowedOrgIds.length === 0) {
    return true;
  }

  const allowed = allowedOrgIds.includes(orgId);
  if (!allowed) {
    logger.info(`Org ${orgId} is not in the allowlist, skipping`);
  }
  return allowed;
}
