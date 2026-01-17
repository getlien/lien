import crypto from 'crypto';
import fs from 'fs/promises';

/**
 * Threshold for using fingerprint approach (1MB)
 */
const LARGE_FILE_THRESHOLD = 1024 * 1024;

/**
 * Sample size for large file fingerprinting (8KB)
 */
const SAMPLE_SIZE = 8192;

/**
 * Compute a content hash for change detection.
 * 
 * For small files (<1MB), computes hash of entire content.
 * For large files (>=1MB), uses fingerprint approach (first 8KB + last 8KB + size).
 * 
 * Returns 16-character hash (or 'L' prefix + 15 chars for large files).
 * 
 * @param filepath - Absolute path to the file
 * @returns Content hash string, or empty string if file cannot be read
 */
export async function computeContentHash(filepath: string): Promise<string> {
  try {
    const stats = await fs.stat(filepath);
    
    // For large files, use fingerprint: first 8KB + last 8KB + file size
    if (stats.size > LARGE_FILE_THRESHOLD) {
      return await computeLargeFileFingerprint(filepath, stats.size);
    }
    
    // For normal files, hash entire content
    const content = await fs.readFile(filepath, 'utf-8');
    return crypto.createHash('sha256').update(content).digest('hex').slice(0, 16);
  } catch {
    // If file can't be read, return empty hash (will trigger reindex)
    return '';
  }
}

/**
 * Compute fingerprint for large files to avoid reading entire content.
 * Uses first 8KB + last 8KB + file size.
 * 
 * @param filepath - Absolute path to the file
 * @param size - File size in bytes
 * @returns Fingerprint hash with 'L' prefix
 */
async function computeLargeFileFingerprint(filepath: string, size: number): Promise<string> {
  const handle = await fs.open(filepath, 'r');
  
  try {
    const headBuffer = Buffer.alloc(SAMPLE_SIZE);
    const tailBuffer = Buffer.alloc(SAMPLE_SIZE);
    
    // Read first 8KB
    await handle.read(headBuffer, 0, SAMPLE_SIZE, 0);
    
    // Read last 8KB
    const tailOffset = Math.max(0, size - SAMPLE_SIZE);
    await handle.read(tailBuffer, 0, SAMPLE_SIZE, tailOffset);
    
    // Combine: head + tail + size
    const hash = crypto.createHash('sha256');
    hash.update(headBuffer);
    hash.update(tailBuffer);
    hash.update(size.toString());
    
    return 'L' + hash.digest('hex').slice(0, 15); // 'L' prefix = large file fingerprint
  } finally {
    await handle.close();
  }
}

/**
 * Check if hash algorithm is compatible with current implementation.
 * 
 * @param algorithm - Hash algorithm version from manifest
 * @returns true if compatible, false otherwise
 */
export function isHashAlgorithmCompatible(algorithm?: string): boolean {
  // If no algorithm specified, assume old format (still compatible)
  if (!algorithm) return true;
  
  // Current supported algorithms
  return algorithm === 'sha256-16' || algorithm === 'sha256-16-large';
}
