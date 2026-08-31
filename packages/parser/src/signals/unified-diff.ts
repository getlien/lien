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

/**
 * A whole diff, split into what `SignalContext.pr` carries: the raw patch text
 * per file, and the post-image line numbers per file.
 */
export interface ParsedUnifiedDiff {
  patches: Map<string, string>;
  diffLines: Map<string, Set<number>>;
}

/** Block separator, at the start of a line. */
const DIFF_BLOCK_RE = /^diff --git /m;
/**
 * The post-image path, from the `+++` header. `/dev/null` means deleted.
 *
 * Captures everything after `+++ ` and leaves the `b/` prefix on, because when
 * the path is quoted the prefix is INSIDE the quotes (`"b/caf\303\251.ts"`) —
 * so stripping it has to happen after unquoting, not in this pattern.
 */
const POST_IMAGE_PATH_RE = /^\+\+\+ (.+)$/m;
/** Fallback: the block's own `a/… b/…` header, unquoted. */
const GIT_HEADER_PATH_RE = /^a\/(.+?) b\/(.+?)$/m;
/**
 * The same header when git quoted BOTH paths, which it does for non-ASCII.
 *
 * Needed because the unquoted pattern cannot match a quoted header at all, so a
 * binary or mode-only change to a non-ASCII path — which has no `+++` line to
 * fall back from — produced no entry whatsoever.
 */
const GIT_HEADER_QUOTED_RE = /^("(?:[^"\\]|\\.)*") ("(?:[^"\\]|\\.)*")$/m;

/**
 * Undo the decorations git applies to a path in a `---`/`+++` header.
 *
 * Two of them, both silent and both fatal if left in place, because the result
 * is used to look the file up on disk and to read its extension:
 *
 *  - **A trailing TAB** whenever the path contains a space. `sub dir/a.ts`
 *    arrives as `sub dir/a.ts\t`, whose extension reads as `.ts\t` — so the file
 *    is judged unanalyzable and silently dropped from the review. Note this hits
 *    exactly the case taking the path from `+++` was meant to fix.
 *  - **Octal-escaped quoting** for non-ASCII, from `core.quotePath`, which is ON
 *    by default: `café.ts` arrives as `"caf\303\251.ts"`.
 */
/**
 * Git's C-style escapes, by the character following the backslash, to the byte
 * it denotes. Anything not here (`\"`, `\\`) is the literal character.
 */
const C_ESCAPES: Record<string, number | undefined> = {
  a: 0x07,
  b: 0x08,
  f: 0x0c,
  n: 0x0a,
  r: 0x0d,
  t: 0x09,
  v: 0x0b,
};

function undecoratePath(raw: string): string {
  const detabbed = raw.replace(/\t+$/, '');
  if (!detabbed.startsWith('"') || !detabbed.endsWith('"')) return detabbed;

  const inner = detabbed.slice(1, -1);
  // Octal escapes are per-BYTE, so decode to bytes and then read as UTF-8 —
  // decoding each escape as a code point would mangle any multi-byte character.
  const bytes: number[] = [];
  for (let i = 0; i < inner.length; i++) {
    const octal = /^\\([0-7]{3})/.exec(inner.slice(i));
    if (octal !== null) {
      bytes.push(parseInt(octal[1], 8));
      i += 3;
      continue;
    }
    if (inner[i] === '\\' && i + 1 < inner.length) {
      i++;
      // Git's C-style escapes. Without this table `\t` decoded to the LETTER
      // `t`, so a path containing a tab came out silently wrong rather than
      // failing — the worst outcome for something used to open a file.
      const named = C_ESCAPES[inner[i]];
      bytes.push(named ?? inner.charCodeAt(i));
      continue;
    }
    bytes.push(inner.charCodeAt(i));
  }

  return new TextDecoder().decode(new Uint8Array(bytes));
}

/**
 * A `---`/`+++` header path, undecorated and with its `a/`/`b/` prefix removed.
 *
 * Order matters: the prefix sits inside the quotes for a quoted path, so it can
 * only be stripped once the quoting is gone. Stripping is unconditional rather
 * than pattern-matched on the prefix, which is why `diff.noprefix` should be
 * pinned off at the git call — with it on, a file genuinely under a directory
 * named `b` would lose that segment. Accepted: a diff this package generates
 * always carries the prefix.
 */
function headerPath(raw: string): string {
  const undecorated = undecoratePath(raw);
  if (undecorated === '/dev/null') return undecorated;
  return undecorated.replace(/^[ab]\//, '');
}

/**
 * Split a unified diff into per-file patches plus the lines each one touches.
 *
 * The path comes from the `+++` header rather than the block header wherever
 * possible, because the block header has no unambiguous split when a filename
 * contains a space — its only separator is the literal ` b/`. The `+++` line
 * carries one path and needs no split.
 *
 * A block whose post-image is `/dev/null` is a deletion: it gets an entry with
 * an empty line set rather than being dropped, so a caller can distinguish
 * "this file was deleted" from "this file was not in the diff at all".
 *
 * Known ambiguity, unavoidable without invoking git once per file: a filename
 * containing the literal ` b/` breaks the fallback split. Only reachable for a
 * block with no `+++` line — a pure mode change, or a binary file.
 */
export function parseUnifiedDiff(diff: string): ParsedUnifiedDiff {
  const patches = new Map<string, string>();
  const diffLines = new Map<string, Set<number>>();

  for (const block of diff.split(DIFF_BLOCK_RE).slice(1)) {
    const rawPostImage = block.match(POST_IMAGE_PATH_RE)?.[1];
    const postImage = rawPostImage === undefined ? undefined : headerPath(rawPostImage);
    // Quoted form first: a quoted header never matches the unquoted pattern,
    // but an unquoted one could partially match the quoted pattern's shape.
    const fallback = block.match(GIT_HEADER_QUOTED_RE)?.[2] ?? block.match(GIT_HEADER_PATH_RE)?.[2];
    const filepath =
      postImage !== undefined && postImage !== '/dev/null'
        ? postImage
        : fallback === undefined
          ? undefined
          : headerPath(fallback);
    if (filepath === undefined) continue;

    // Re-attach the separator the split consumed, so a consumer scanning the
    // patch text sees exactly what git emitted.
    patches.set(filepath, `diff --git ${block}`.trimEnd());
    diffLines.set(filepath, postImage === '/dev/null' ? new Set() : parsePatchLines(block));
  }

  return { patches, diffLines };
}
