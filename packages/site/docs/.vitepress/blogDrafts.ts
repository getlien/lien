// Draft-gating for the /blog section.
//
// A post is a draft when its frontmatter has `draft: true`. Drafts render
// normally in `vitepress dev` (with a visible DRAFT banner — see
// theme/components/DraftBanner.vue) so the owner can review them locally,
// but must be fully absent from the production build: no listing entry, no
// generated page, nothing in the built output. See
// docs/development/blog-authoring.md for the full mechanism + the flip
// procedure (how a post goes from draft to published).
//
// This file is Node-only (imported from config.ts, which runs in Node, not
// the browser) so it reads frontmatter with a small regex instead of adding
// a YAML/frontmatter-parsing dependency — vitepress bundles `gray-matter`
// internally for its own content loader, but doesn't expose it for reuse.
import fs from 'node:fs';
import path from 'node:path';

const FRONTMATTER_RE = /^---\r?\n([\s\S]*?)\r?\n---/;
const DRAFT_TRUE_RE = /^draft:\s*true\s*$/m;

/** Reads a markdown file's frontmatter block and reports whether `draft: true` is set. */
export function isDraftFile(absPath: string): boolean {
  const raw = fs.readFileSync(absPath, 'utf-8');
  const match = raw.match(FRONTMATTER_RE);
  if (!match) return false;
  return DRAFT_TRUE_RE.test(match[1]);
}

/**
 * Glob patterns (relative to the VitePress `srcDir`, i.e. `docs/`) for every
 * draft post under `blog/posts/`. Feed this into `srcExclude` during a
 * production build so draft posts are never resolved as routable pages —
 * the strongest possible exclusion, since the page simply doesn't exist in
 * the output rather than existing-but-hidden.
 */
export function getDraftPostExcludes(srcDir: string): string[] {
  const postsDir = path.join(srcDir, 'blog', 'posts');
  if (!fs.existsSync(postsDir)) return [];
  return fs
    .readdirSync(postsDir)
    .filter((file) => file.endsWith('.md'))
    .filter((file) => isDraftFile(path.join(postsDir, file)))
    .map((file) => `blog/posts/${file}`);
}
