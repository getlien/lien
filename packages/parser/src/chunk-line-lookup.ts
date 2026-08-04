/**
 * Locating a file line inside a chunk's own `content`.
 *
 * `absoluteLine - chunk.metadata.startLine` is the obvious arithmetic and it is
 * only exact when the chunk's content starts on exactly the line `startLine`
 * names. A module-level chunk's does not: `ast/chunker.ts`'s
 * `createChunkFromRange` trims its range's leading blank lines out of the
 * content — a gap between two functions starts on the blank line right after
 * the first one — while `startLine` keeps naming the untrimmed start. The
 * arithmetic then OVERSHOOTS by however many lines were trimmed, landing on a
 * later statement or past the end of the content entirely.
 *
 * That was unreachable before #1087, because module-level chunks carried no
 * call sites to build a snippet for. It is now the common case, and it had two
 * independent implementations of the same arithmetic to go wrong in
 * (`dependency-analyzer.ts`'s `extractSnippet` for `get_dependents` usages,
 * `review`'s `extractSnippetWindow` for PR-review context) — the shape that
 * keeps producing "one decision implemented at N sites, fixed at fewer than N"
 * bugs here. Hence one shared lookup rather than two parallel fixes.
 *
 * Deliberately corrects the LOOKUP rather than narrowing a chunk's own
 * `startLine`/`endLine` to match its content: `isValidChunk` measures
 * `minChunkSize` from exactly those two fields, so shrinking them would
 * silently drop small module-level chunks from the index — the #772 failure
 * mode. The `line` reported alongside a snippet is the call site's own,
 * which is the true file line and was never affected.
 */

/** How far either side of the arithmetic guess to look for the symbol. */
const SEARCH_RADIUS = 5;

/**
 * 0-based index into `lines` of the line that corresponds to file line
 * `absoluteLine`, for a chunk whose metadata claims to start at
 * `chunkStartLine`.
 *
 * Prefers the nearest line that actually mentions `symbolName` — the only
 * evidence available that survives a trimmed offset — searching outward from
 * the arithmetic guess, with the earlier line winning a tie. Falls back to the
 * guess itself when it is in range and nothing nearby mentions the symbol, and
 * returns `null` when even that is out of bounds.
 */
export function findChunkLineIndex(
  lines: string[],
  absoluteLine: number,
  chunkStartLine: number,
  symbolName: string,
): number | null {
  const guess = absoluteLine - chunkStartLine;
  const mentionsSymbol = (i: number) => i >= 0 && i < lines.length && lines[i].includes(symbolName);

  if (mentionsSymbol(guess)) return guess;

  // Nearest offset first, and within an offset the earlier line first.
  const nearby = Array.from({ length: SEARCH_RADIUS }, (_, k) => k + 1).flatMap(offset => [
    guess - offset,
    guess + offset,
  ]);
  const found = nearby.find(mentionsSymbol);
  if (found !== undefined) return found;

  return guess >= 0 && guess < lines.length ? guess : null;
}
