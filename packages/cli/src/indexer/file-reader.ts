import fs from 'fs/promises';
import pLimit from 'p-limit';

/**
 * Parallel file reader that efficiently reads multiple files concurrently.
 * Uses p-limit to control concurrency and avoid overwhelming the filesystem.
 */
export class ParallelFileReader {
  private concurrency: number;
  
  /**
   * Creates a new ParallelFileReader
   * @param concurrency - Maximum number of concurrent file reads (default: 20)
   */
  constructor(concurrency: number = 20) {
    this.concurrency = concurrency;
  }
  
  /**
   * Reads multiple files in parallel with concurrency control.
   * Filters out files that fail to read (e.g., permissions, deleted files).
   * 
   * @param filepaths - Array of absolute file paths to read
   * @returns Map of filepath -> file content (only successful reads)
   */
  async readFiles(filepaths: string[]): Promise<Map<string, string>> {
    const limit = pLimit(this.concurrency);
    
    const results = await Promise.all(
      filepaths.map(filepath =>
        limit(async () => {
          try {
            const content = await fs.readFile(filepath, 'utf-8');
            return [filepath, content] as const;
          } catch (error) {
            // File read failed (deleted, permission denied, binary, etc.)
            // Return null and filter it out later
            return [filepath, null] as const;
          }
        })
      )
    );
    
    // Filter out failed reads and create map
    const successfulReads = results.filter(
      ([, content]) => content !== null
    ) as Array<[string, string]>;
    
    return new Map(successfulReads);
  }
  
  /**
   * Reads a single file (convenience method)
   * @param filepath - File path to read
   * @returns File content or null if read failed
   */
  async readFile(filepath: string): Promise<string | null> {
    try {
      return await fs.readFile(filepath, 'utf-8');
    } catch {
      return null;
    }
  }
}

