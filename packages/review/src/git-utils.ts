const SHA_PATTERN = /^[0-9a-f]{7,40}$/i;

export function assertValidSha(sha: string, label: string): void {
  if (!SHA_PATTERN.test(sha)) {
    throw new Error(
      `Invalid ${label}: must be a 7-40 character hex string, got "${sha}"`,
    );
  }
}
