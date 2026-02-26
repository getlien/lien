/**
 * Split an array into chunks of the given size.
 *
 * @param arr - Array to split
 * @param size - Maximum chunk size (must be > 0)
 * @returns Array of chunks (sub-arrays)
 */
export function chunkArray<T>(arr: T[], size: number): T[][] {
  if (size <= 0) throw new RangeError('chunkArray: size must be greater than 0');
  if (arr.length === 0) return [];

  const chunks: T[][] = [];
  for (let i = 0; i < arr.length; i += size) {
    chunks.push(arr.slice(i, i + size));
  }
  return chunks;
}
