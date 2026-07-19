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
        tags: page.frontmatter.tags ?? [],
        draft: Boolean(page.frontmatter.draft),
        url: page.url,
      }))
      .sort((a, b) => (a.date < b.date ? 1 : -1))
  },
})
