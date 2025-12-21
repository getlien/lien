import fs from 'fs/promises';
import path from 'path';
import os from 'os';
import { exec } from 'child_process';
import { promisify } from 'util';

const execAsync = promisify(exec);

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
  if (process.env.LIEN_BACKEND) {
    const backend = process.env.LIEN_BACKEND as 'lancedb' | 'qdrant';
    
    if (backend === 'qdrant' && process.env.LIEN_QDRANT_URL) {
      return {
        backend: 'qdrant',
        qdrant: {
          url: process.env.LIEN_QDRANT_URL,
          apiKey: process.env.LIEN_QDRANT_API_KEY,
        },
      };
    }
    
    return { backend };
  }
  
  // 2. Check global config file
  const configPath = path.join(os.homedir(), '.lien', 'config.json');
  try {
    const content = await fs.readFile(configPath, 'utf-8');
    const config = JSON.parse(content) as GlobalConfig;
    
    // Validate structure
    if (config.backend && !['lancedb', 'qdrant'].includes(config.backend)) {
      throw new Error(`Invalid backend: ${config.backend}. Must be 'lancedb' or 'qdrant'`);
    }
    
    if (config.backend === 'qdrant' && config.qdrant && !config.qdrant.url) {
      throw new Error('Qdrant backend requires qdrant.url in config');
    }
    
    return config;
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === 'ENOENT') {
      // File doesn't exist - use defaults
      return { backend: 'lancedb' };
    }
    
    // Re-throw validation errors
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

