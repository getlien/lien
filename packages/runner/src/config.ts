/**
 * Environment variable loading for the runner.
 */

export interface RunnerConfig {
  natsUrl: string;
  natsStream: string;
  natsConsumer: string;
  laravelApiUrl: string;
  openrouterApiKey: string;
  openrouterModel: string;
  pullTimeoutMs: number;
  jobTimeoutMs: number;
}

function parsePositiveInt(value: string | undefined, fallback: number, name: string): number {
  if (!value) return fallback;
  const parsed = parseInt(value, 10);
  if (isNaN(parsed) || parsed <= 0) {
    throw new Error(`${name} must be a positive integer, got "${value}"`);
  }
  return parsed;
}

export function loadConfig(): RunnerConfig {
  const laravelApiUrl = process.env.LARAVEL_API_URL;
  if (!laravelApiUrl) {
    throw new Error('LARAVEL_API_URL environment variable is required');
  }

  return {
    natsUrl: process.env.NATS_URL ?? 'nats://nats:4222',
    natsStream: process.env.NATS_STREAM ?? 'reviews',
    natsConsumer: process.env.NATS_CONSUMER ?? 'reviews-runner',
    laravelApiUrl,
    openrouterApiKey: process.env.OPENROUTER_API_KEY ?? '',
    openrouterModel: process.env.OPENROUTER_MODEL ?? 'minimax/minimax-m2.5',
    pullTimeoutMs: parsePositiveInt(process.env.PULL_TIMEOUT_MS, 30_000, 'PULL_TIMEOUT_MS'),
    jobTimeoutMs: parsePositiveInt(process.env.JOB_TIMEOUT_MS, 600_000, 'JOB_TIMEOUT_MS'),
  };
}
