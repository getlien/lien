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
// the browser). Frontmatter is parsed with `js-yaml` (the same library
// VitePress's own bundled `gray-matter` uses internally, though it isn't
// exposed for reuse) rather than a regex — a regex match on `draft:\s*true`
// disagrees with a real YAML parser on cases like `draft: true  # note` or
// `draft: True`, which would make srcExclude silently miss a real draft
// while the (accurately YAML-parsed) content loader still hid it from the
// listing — a page generated in `dist/` with no link pointing at it, but
// reachable by URL. Parsing frontmatter the same way VitePress does closes
// that gap.
import fs from 'node:fs'
import path from 'node:path'
import yaml from 'js-yaml'

const FRONTMATTER_RE = /^---\r?\n([\s\S]*?)\r?\n---/

/** Reads a markdown file's frontmatter block and reports whether `draft: true` is set. */
export function isDraftFile(absPath: string): boolean {
  const raw = fs.readFileSync(absPath, 'utf-8')
  const match = raw.match(FRONTMATTER_RE)
  if (!match) return false
  const frontmatter = yaml.load(match[1])
  if (!frontmatter || typeof frontmatter !== 'object') return false
  return (frontmatter as Record<string, unknown>).draft === true
}

/**
 * Glob patterns (relative to the VitePress `srcDir`, i.e. `docs/`) for every
 * draft post under `blog/posts/`. Feed this into `srcExclude` during a
 * production build so draft posts are never resolved as routable pages —
 * the strongest possible exclusion, since the page simply doesn't exist in
 * the output rather than existing-but-hidden.
 */
export function getDraftPostExcludes(srcDir: string): string[] {
  const postsDir = path.join(srcDir, 'blog', 'posts')
  if (!fs.existsSync(postsDir)) return []
  return fs
    .readdirSync(postsDir)
    .filter((file) => file.endsWith('.md'))
    .filter((file) => isDraftFile(path.join(postsDir, file)))
    .map((file) => `blog/posts/${file}`)
}
