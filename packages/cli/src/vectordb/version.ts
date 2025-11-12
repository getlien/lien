import fs from 'fs/promises';
import path from 'path';

const VERSION_FILE = '.lien-index-version';

/**
 * Writes a version timestamp file to mark when the index was last updated.
 * This file is used by the MCP server to detect when it needs to reconnect.
 * 
 * @param indexPath - Path to the index directory
 */
export async function writeVersionFile(indexPath: string): Promise<void> {
  try {
    const versionFilePath = path.join(indexPath, VERSION_FILE);
    const timestamp = Date.now().toString();
    await fs.writeFile(versionFilePath, timestamp, 'utf-8');
  } catch (error) {
    // Don't throw - version file is a convenience feature, not critical
    console.error(`Warning: Failed to write version file: ${error}`);
  }
}

/**
 * Reads the version timestamp from the index directory.
 * Returns 0 if the file doesn't exist (e.g., old index).
 * 
 * @param indexPath - Path to the index directory
 * @returns Version timestamp, or 0 if not found
 */
export async function readVersionFile(indexPath: string): Promise<number> {
  try {
    const versionFilePath = path.join(indexPath, VERSION_FILE);
    const content = await fs.readFile(versionFilePath, 'utf-8');
    const timestamp = parseInt(content.trim(), 10);
    return isNaN(timestamp) ? 0 : timestamp;
  } catch (error) {
    // File doesn't exist or can't be read - treat as version 0
    return 0;
  }
}

