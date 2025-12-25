import fs from 'fs/promises';
import path from 'path';
import os from 'os';
import { exec } from 'child_process';
import { promisify } from 'util';

const execAsync = promisify(exec);

/**
 * Error thrown when config file exists but has invalid syntax or structure.
 * This is separate from "file not found" which is expected behavior.
 */
export class ConfigValidationError extends Error {
  constructor(message: string, public readonly configPath: string) {
    super(message);
    this.name = 'ConfigValidationError';
  }
}

/**
 * Global configuration for Lien.
 * Only contains what truly needs configuration: storage backend choice.
 */
export interface GlobalConfig {
  backend?: 'lancedb' | 'qdrant';
  qdrant?: {
    url: string;
    apiKey?: string;
    // orgId is auto-detected from git remote - not in config!
  };
}

/**
 * Load configuration from environment variables if present.
 */
function loadConfigFromEnv(): GlobalConfig | null {
  const backendEnv = process.env.LIEN_BACKEND;
  if (!backendEnv) {
    return null;
  }
  
  // Validate backend value
  const validBackends = ['lancedb', 'qdrant'] as const;
  if (!validBackends.includes(backendEnv as any)) {
    throw new ConfigValidationError(
      `Invalid LIEN_BACKEND environment variable: "${backendEnv}"\n` +
      `Valid values: 'lancedb' or 'qdrant'`,
      '<environment>'
    );
  }
  
  const backend = backendEnv as 'lancedb' | 'qdrant';
  
  if (backend === 'qdrant') {
    const url = process.env.LIEN_QDRANT_URL;
    if (!url) {
      // Fail fast with clear error instead of returning incomplete config
      throw new ConfigValidationError(
        'Qdrant backend requires LIEN_QDRANT_URL environment variable.\n' +
        'Set it with: export LIEN_QDRANT_URL=http://localhost:6333',
        '<environment>'
      );
    }
    
    return {
      backend: 'qdrant',
      qdrant: {
        url,
        apiKey: process.env.LIEN_QDRANT_API_KEY,
      },
    };
  }
  
  return { backend };
}

/**
 * Parse and validate a config object.
 */
function validateConfig(config: GlobalConfig, configPath: string): void {
  // Validate backend value
  if (config.backend && !['lancedb', 'qdrant'].includes(config.backend)) {
    throw new ConfigValidationError(
      `Invalid backend in global config: "${config.backend}"\n` +
      `Config file: ${configPath}\n` +
      `Valid values: 'lancedb' or 'qdrant'`,
      configPath
    );
  }
  
  // Validate Qdrant configuration
  if (config.backend === 'qdrant') {
    if (!config.qdrant) {
      throw new ConfigValidationError(
        `Qdrant backend requires a "qdrant" configuration section\n` +
        `Config file: ${configPath}\n` +
        `Add: { "qdrant": { "url": "http://localhost:6333" } }`,
        configPath
      );
    }
    
    if (!config.qdrant.url) {
      throw new ConfigValidationError(
        `Qdrant backend requires qdrant.url in config\n` +
        `Config file: ${configPath}\n` +
        `Add: { "qdrant": { "url": "http://localhost:6333" } }`,
        configPath
      );
    }
  }
}

/**
 * Parse JSON config file with helpful error messages.
 */
function parseConfigFile(content: string, configPath: string): GlobalConfig {
  try {
    return JSON.parse(content) as GlobalConfig;
  } catch (parseError) {
    const errorMsg = parseError instanceof Error ? parseError.message : String(parseError);
    throw new ConfigValidationError(
      `Failed to parse global config file.\n` +
      `Config file: ${configPath}\n` +
      `Syntax error: ${errorMsg}\n\n` +
      `Please fix the JSON syntax errors in your config file.`,
      configPath
    );
  }
}

/**
 * Load global configuration from environment variables or config file.
 * 
 * Precedence:
 * 1. Environment variables (highest)
 * 2. Global config file (~/.lien/config.json)
 * 3. Defaults (LanceDB)
 * 
 * @returns Global configuration
 */
export async function loadGlobalConfig(): Promise<GlobalConfig> {
  // 1. Check environment variables first
  const envConfig = loadConfigFromEnv();
  if (envConfig) {
    return envConfig;
  }
  
  // 2. Check global config file
  const configPath = path.join(os.homedir(), '.lien', 'config.json');
  try {
    const content = await fs.readFile(configPath, 'utf-8');
    const config = parseConfigFile(content, configPath);
    validateConfig(config, configPath);
    return config;
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === 'ENOENT') {
      // File doesn't exist - use defaults (this is normal)
      return { backend: 'lancedb' };
    }
    
    // Re-throw all other errors (validation errors, JSON parse errors, etc.)
    throw error;
  }
}

/**
 * Parse HTTPS/HTTP git URLs (e.g., https://github.com/org/repo.git).
 */
function parseHttpsGitUrl(url: string): string | null {
  const match = url.match(/https?:\/\/(?:[\w\.-]+@)?[\w\.-]+\/([\w\.-]+)\/([\w\.-]+)(?:\.git)?/);
  return match ? match[1] : null;
}

/**
 * Parse SSH git URLs (e.g., git@github.com:org/repo.git).
 */
function parseSshGitUrl(url: string): string | null {
  const match = url.match(/git@[\w\.-]+:([\w\.-]+)\/([\w\.-]+)(?:\.git)?/);
  return match ? match[1] : null;
}

/**
 * Parse SSH protocol URLs (e.g., ssh://git@host.com/org/repo.git).
 */
function parseSshProtocolUrl(url: string): string | null {
  const match = url.match(/ssh:\/\/(?:[\w\.-]+@)?[\w\.-]+\/([\w\.-]+)\/([\w\.-]+)(?:\.git)?/);
  return match ? match[1] : null;
}

/**
 * Parse generic git URLs (fallback: org/repo at the end).
 */
function parseGenericGitUrl(url: string): string | null {
  const match = url.match(/([\w\.-]+)\/([\w\.-]+)(?:\.git)?$/);
  return match ? match[1] : null;
}

/**
 * Get git remote URL from repository.
 */
async function getGitRemoteUrl(rootDir: string): Promise<string | null> {
  // Check if it's a git repo first
  const gitDir = path.join(rootDir, '.git');
  try {
    await fs.access(gitDir);
  } catch {
    return null; // Not a git repo
  }
  
  // Get remote URL (prefer 'origin', fallback to first remote)
  try {
    const { stdout } = await execAsync('git remote get-url origin', {
      cwd: rootDir,
      timeout: 5000,
    });
    return stdout.trim();
  } catch {
    // If origin doesn't exist, get first remote
    try {
      const { stdout: remoteList } = await execAsync('git remote', {
        cwd: rootDir,
        timeout: 5000,
      });
      const remoteName = remoteList.trim().split('\n')[0];
      if (!remoteName) return null;
      
      const { stdout } = await execAsync(`git remote get-url ${remoteName}`, {
        cwd: rootDir,
        timeout: 5000,
      });
      return stdout.trim();
    } catch {
      return null; // No remotes configured
    }
  }
}

/**
 * Extract organization ID from git remote URL.
 * Supports GitHub, GitLab, Bitbucket, and other common formats.
 * 
 * Examples:
 * - https://github.com/org/repo.git → "org"
 * - git@github.com:org/repo.git → "org"
 * - https://gitlab.com/org/repo.git → "org"
 * - https://bitbucket.org/org/repo.git → "org"
 * 
 * @param rootDir - Root directory of the project (must be a git repo)
 * @returns Organization ID, or null if not a git repo or can't extract
 */
export async function extractOrgIdFromGit(rootDir: string): Promise<string | null> {
  try {
    const remoteUrl = await getGitRemoteUrl(rootDir);
    if (!remoteUrl) return null;
    
    // Try parsers in order of specificity
    const parsers = [
      parseHttpsGitUrl,
      parseSshGitUrl,
      parseSshProtocolUrl,
      parseGenericGitUrl,
    ];
    
    for (const parser of parsers) {
      const orgId = parser(remoteUrl);
      if (orgId) return orgId;
    }
    
    return null;
  } catch {
    return null; // Git not available or other error
  }
}

