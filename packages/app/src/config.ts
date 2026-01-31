export interface AppConfig {
  /** GitHub App ID */
  appId: string;
  /** GitHub App private key (PEM format) */
  privateKey: string;
  /** Webhook secret for verifying GitHub signatures */
  webhookSecret: string;
  /** OpenRouter API key for LLM-based review comments */
  openRouterApiKey: string;
  /** OpenRouter model to use */
  openRouterModel: string;
  /** Port to listen on */
  port: number;
  /** Allowed org IDs (empty = allow all) */
  allowedOrgIds: number[];
}

function parsePort(value: string | undefined): number {
  const port = parseInt(value ?? '3000', 10);
  if (Number.isNaN(port) || port < 1 || port > 65535) {
    throw new Error(`Invalid PORT: ${value}`);
  }
  return port;
}

export function loadConfig(): AppConfig {
  const required = (name: string): string => {
    const value = process.env[name];
    if (!value) {
      throw new Error(`Missing required environment variable: ${name}`);
    }
    return value;
  };

  const privateKey = required('GITHUB_APP_PRIVATE_KEY').replace(/\\n/g, '\n');
  if (!privateKey.includes('-----BEGIN') || !privateKey.includes('-----END')) {
    throw new Error('GITHUB_APP_PRIVATE_KEY does not appear to be a valid PEM key');
  }

  const allowedOrgIds = process.env.ALLOWED_ORG_IDS
    ? process.env.ALLOWED_ORG_IDS.split(',')
        .map(id => parseInt(id.trim(), 10))
        .filter(id => !Number.isNaN(id))
    : [];

  return {
    appId: required('GITHUB_APP_ID'),
    privateKey,
    webhookSecret: required('WEBHOOK_SECRET'),
    openRouterApiKey: required('OPENROUTER_API_KEY'),
    openRouterModel: process.env.OPENROUTER_MODEL ?? 'google/gemini-2.0-flash-001',
    port: parsePort(process.env.PORT),
    allowedOrgIds,
  };
}
