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
    // Check if it's a git repo first
    const gitDir = path.join(rootDir, '.git');
    try {
      await fs.access(gitDir);
    } catch {
      return null; // Not a git repo
    }
    
    // Get remote URL (prefer 'origin', fallback to first remote)
    let remoteUrl: string;
    
    try {
      const { stdout } = await execAsync('git remote get-url origin', {
        cwd: rootDir,
        timeout: 5000,
      });
      remoteUrl = stdout.trim();
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
        remoteUrl = stdout.trim();
      } catch {
        return null; // No remotes configured
      }
    }
    
    if (!remoteUrl) return null;
    
    // Parse URL to extract org
    // Match patterns like:
    // - https://github.com/org/repo.git
    // - git@github.com:org/repo.git
    // - https://gitlab.com/org/repo.git
    // - https://bitbucket.org/org/repo.git
    // - ssh://git@host.com/org/repo.git
    const patterns = [
      // Standard HTTPS/SSH: https://github.com/org/repo or git@github.com:org/repo
      /(?:https?:\/\/|git@)(?:[\w\.-]+@)?([\w\.-]+)[\/:]([\w\.-]+)\/([\w\.-]+)(?:\.git)?/,
      // SSH with protocol: ssh://git@host.com/org/repo
      /ssh:\/\/(?:[\w\.-]+@)?([\w\.-]+)\/([\w\.-]+)\/([\w\.-]+)(?:\.git)?/,
      // Fallback: just org/repo at the end
      /([\w\.-]+)\/([\w\.-]+)(?:\.git)?$/,
    ];
    
    for (const pattern of patterns) {
      const match = remoteUrl.match(pattern);
      if (match) {
        // Pattern 1 & 2: match[2] is org, match[3] is repo
        // Pattern 3: match[1] is org, match[2] is repo
        const orgIndex = match.length === 4 ? 2 : 1;
        if (match[orgIndex]) {
          return match[orgIndex];
        }
      }
    }
    
    return null;
  } catch {
    return null; // Git not available or other error
  }
}

