const SHA_PATTERN = /^[0-9a-f]{7,40}$/i;

function sanitizeForLog(value: string): string {
  const cleaned = value.replace(/[\x00-\x1f\x7f]/g, '');
  const truncated = cleaned.length > 80 ? cleaned.slice(0, 80) + '...' : cleaned;
  return JSON.stringify(truncated);
}

export function assertValidSha(sha: string, label: string): void {
  if (!SHA_PATTERN.test(sha)) {
    throw new Error(
      `Invalid ${label}: must be a 7-40 character hex string, got ${sanitizeForLog(sha)}`,
    );
  }
}
