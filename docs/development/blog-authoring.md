# Authoring the /blog Section

The blog lives at `packages/site/docs/blog/`:

```
packages/site/docs/blog/
├── index.md          # listing page (always built, never gated)
├── posts.data.ts      # VitePress content loader for the listing
└── posts/
    ├── why-we-built-lien.md
    ├── complexity-nudges-ab-test.md
    └── reviewer-that-cant-skip-candidate-loops.md
```

A new post is a markdown file under `docs/blog/posts/` with frontmatter:

```yaml
---
title: "Post Title"
description: "One-sentence summary, used in the listing card."
date: 2026-07-19
author: Alf Henderson
tags: [optional, tag, chips]
draft: true
---
```

`date`/`author`/`tags` also drive the byline rendered above the post body
(`theme/components/PostMeta.vue`) — any page with a `date` frontmatter field
gets that byline automatically, no per-page wiring needed.

## Draft gating

A post with `draft: true` behaves differently depending on how the site is
run:

- **`npm run docs:dev`** — draft posts render normally, with a visible
  amber "DRAFT" banner injected above the content
  (`theme/components/DraftBanner.vue`) and a "DRAFT" chip on their listing
  card. This is how the owner reviews a draft locally before publishing it.
- **`npm run docs:build`** (production) — draft posts are excluded from
  everything: the listing (`posts.data.ts` filters them out at load time,
  via `import.meta.env.PROD`, so a draft's title/description never even
  enter the built client bundle), the nav (the top-level "Blog" nav entry
  just links to the always-built index page, not to individual posts), any
  future sitemap (there's no sitemap generator in this VitePress site today;
  since a draft's page is never part of VitePress's resolved page list, any
  sitemap generator added later would exclude it automatically), and
  rendering (the draft's `.md` file is added to VitePress's `srcExclude`
  during a production build, so no HTML page is generated for it at all —
  its URL 404s because the file genuinely doesn't exist in `dist/`, not
  because of a runtime check).

The mechanism: `docs/.vitepress/config.ts` is a command-aware config
function (`defineConfig(({ command }) => ...)` — VitePress/Vite pass
`command: 'build' | 'serve'`). Only when `command === 'build'` does it
compute `srcExclude` from `docs/.vitepress/blogDrafts.ts`'s
`getDraftPostExcludes()`, which scans `docs/blog/posts/*.md` for
`draft: true` frontmatter with a small regex (no YAML-parsing dependency
needed — VitePress bundles one internally but doesn't expose it for reuse).
`docs:dev`/`docs:preview` never populate `srcExclude`, so drafts stay
fully reachable locally.

## Publishing a draft (owner-only)

1. Edit the post's frontmatter: `draft: true` → `draft: false`. Do any voice
   pass / content edits at the same time.
2. Commit and merge to `main` (a normal PR is fine — Lien Review's doc-truth
   rule will check factual claims same as any other change).
3. That's it. `main` pushes trigger `.github/workflows/deploy-docs.yml`,
   which runs `npm run docs:build` and deploys the result to GitHub Pages.
   Once `draft: false` is merged, the next deploy includes the post in the
   build normally — no separate flag, no manual dist edit, no server
   restart.

Flipping a post live is entirely an edit-and-merge action; there is no admin
UI or separate publish step.
