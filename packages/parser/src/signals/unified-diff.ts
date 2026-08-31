/**
 * Unified-diff parsing — the input half of `SignalContext`.
 *
 * `SignalContext.pr.diffLines` is a `Map<string, Set<number>>` of post-image
 * line numbers per file, and this is what produces the `Set<number>`. It lived
 * in the review engine's `github-api.ts`, which meant the only way to get diff
 * parsing was to import a module that also imports Octokit — so a caller
 * driving the signals from a local `git diff` had to either take on a GitHub
 * client it never calls, or fork the logic. The harness already forked it
 * (`packages/review/test/harness/capture-pr.ts`'s `extractPostImageLines`).
 *
 * The function itself never needed any of that: it is a pure walk over patch
 * text.
 */

/**
 * Post-image line numbers a unified diff patch covers — the lines that can
 * carry a review comment.
 *
 * Counts both added (`+`) and context (` `) lines, because a consumer
 * filtering findings to "lines this diff touched" wants context lines too:
 * a bug on a context line adjacent to the change is in scope. Deleted (`-`)
 * lines do not advance the counter, since they have no post-image position.
 *
 * Known limit: the `+++` file-header guard is a prefix test, so an ADDED line
 * whose own content starts with `++` (`++i;` arrives in the patch as `+++i;`)
 * reads as a header and is skipped. The skipped line's number is not lost — it
 * is silently reused by the next line, so every later line in the hunk is
 * attributed one position too low, and the hunk's LAST line falls out of the
 * set entirely. Rare enough to have never been hit (it needs added source
 * beginning with `++`, e.g. a C pre-increment at column 0), and long-standing
 * behaviour; recorded because it is invisible from the call site.
 */
export function parsePatchLines(patch: string): Set<number> {
  const lines = new Set<number>();
  let currentLine = 0;

  for (const patchLine of patch.split('\n')) {
    // Hunk header: @@ -start,count +start,count @@ — the second start is the
    // post-image position, which is what a comment anchors to.
    const hunkMatch = patchLine.match(/^@@ -\d+(?:,\d+)? \+(\d+)(?:,\d+)? @@/);
    if (hunkMatch) {
      currentLine = parseInt(hunkMatch[1], 10);
      continue;
    }

    if (patchLine.startsWith('+') || patchLine.startsWith(' ')) {
      // `+++ b/file` is a file header, not an added line. Without this guard
      // it would be counted at whatever `currentLine` happens to be — 0 when
      // it precedes the first hunk header.
      if (!patchLine.startsWith('+++')) {
        lines.add(currentLine);
        currentLine++;
      }
    }
  }

  return lines;
}
