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

export function loadConfig(): RunnerConfig {
  const laravelApiUrl = process.env.LARAVEL_API_URL;
  if (!laravelApiUrl) {
    throw new Error('LARAVEL_API_URL environment variable is required');
  }

  const openrouterApiKey = process.env.OPENROUTER_API_KEY;
  if (!openrouterApiKey) {
    throw new Error('OPENROUTER_API_KEY environment variable is required');
  }

  return {
    natsUrl: process.env.NATS_URL ?? 'nats://nats:4222',
    natsStream: process.env.NATS_STREAM ?? 'reviews',
    natsConsumer: process.env.NATS_CONSUMER ?? 'reviews-runner',
    laravelApiUrl,
    openrouterApiKey,
    openrouterModel: process.env.OPENROUTER_MODEL ?? 'minimax/minimax-m2.5',
    pullTimeoutMs: parseInt(process.env.PULL_TIMEOUT_MS ?? '30000', 10),
    jobTimeoutMs: parseInt(process.env.JOB_TIMEOUT_MS ?? '600000', 10),
  };
}
