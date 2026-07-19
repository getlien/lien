import { createContentLoader } from 'vitepress'

export interface BlogPostMeta {
  title: string
  description: string
  date: string
  author: string
  tags: string[]
  draft: boolean
  url: string
}

declare const data: BlogPostMeta[]
export { data }

// Draft posts are filtered here (not just via `srcExclude` in config.ts) so
// that a draft's title/description never end up embedded in the production
// client bundle at all. Content loaders run as plain Node ESM (not through
// Vite's module graph), so `import.meta.env` isn't available here — use
// `process.env.NODE_ENV`, which Vite's own config resolution sets to
// `'production'` for `vitepress build` and `'development'` for
// `vitepress dev`/`vitepress preview`. In dev, drafts pass through so the
// index list can show them with the DRAFT chip (see docs/blog/index.md).
const isProductionBuild = process.env.NODE_ENV === 'production'

export default createContentLoader('blog/posts/*.md', {
  transform(raw) {
    return raw
      .filter((page) => (isProductionBuild ? !page.frontmatter.draft : true))
      .map((page) => ({
        title: page.frontmatter.title ?? 'Untitled',
        description: page.frontmatter.description ?? '',
        date: page.frontmatter.date ?? '',
        author: page.frontmatter.author ?? 'Lien Team',
        // Array.isArray guard (not just `?? []`): a malformed `tags: foo`
        // (a bare string, not a YAML list) would otherwise reach the
        // template's `v-for="tag in post.tags"`, which iterates a string
        // character-by-character in Vue — render garbage chips instead of
        // silently no-op'ing.
        tags: Array.isArray(page.frontmatter.tags) ? page.frontmatter.tags : [],
        draft: Boolean(page.frontmatter.draft),
        url: page.url,
      }))
      // Must return 0 for equal dates -- `a.date < b.date ? 1 : -1` returns
      // -1 for BOTH (a, b) and (b, a) when the dates tie, which breaks the
      // total-order contract Array.prototype.sort's comparator relies on
      // (all three seed posts currently share one date, so ties aren't a
      // hypothetical edge case here).
      .sort((a, b) => (a.date < b.date ? 1 : a.date > b.date ? -1 : 0))
  },
})
