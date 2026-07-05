import fs from 'fs/promises';
import type { Dirent } from 'fs';
import path from 'path';

/**
 * Recursively sum the byte size of every regular file under `dir`. Metadata
 * only (no content reads), so it is cheap even for multi-GB index dirs. Missing
 * or unreadable entries contribute 0 rather than throwing — size is reported
 * for information, never a correctness input.
 *
 * @param dir - Directory to measure
 * @returns Total size in bytes
 */
export async function computeDirSize(dir: string): Promise<number> {
  let total = 0;

  let entries: Dirent[];
  try {
    entries = await fs.readdir(dir, { withFileTypes: true });
  } catch {
    return 0;
  }

  for (const entry of entries) {
    const full = path.join(dir, entry.name);
    try {
      if (entry.isDirectory()) {
        total += await computeDirSize(full);
      } else if (entry.isFile()) {
        const stat = await fs.stat(full);
        total += stat.size;
      }
    } catch {
      // Skip entries that vanish or can't be stat'd mid-walk.
    }
  }

  return total;
}

/**
 * Format a byte count as a short human-readable string (e.g. "0 B", "512 B",
 * "1.5 KB", "136.4 MB", "2.0 GB"). Tops out at PB — index dirs never
 * realistically get there, but the unit list still rolls over correctly
 * instead of rendering an out-of-range value like "1024.0 TB".
 *
 * @param bytes - Byte count
 * @returns Formatted string
 */
export function formatBytes(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  const units = ['KB', 'MB', 'GB', 'TB', 'PB'];
  let value = bytes / 1024;
  let unitIndex = 0;
  while (value >= 1024 && unitIndex < units.length - 1) {
    value /= 1024;
    unitIndex++;
  }
  return `${value.toFixed(1)} ${units[unitIndex]}`;
}
