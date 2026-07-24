import path from 'node:path'
import type { DefaultTheme, HeadConfig } from 'vitepress'
import type { UserConfigExport } from 'vitepress'
import { withMermaid } from 'vitepress-plugin-mermaid'
import { getDraftPostExcludes } from './blogDrafts'

const srcDir = path.resolve(__dirname, '..')

const head: HeadConfig[] = [
  ['link', { rel: 'icon', type: 'image/svg+xml', href: '/favicon.svg' }],
  ['link', { rel: 'stylesheet', href: 'https://api.fontshare.com/v2/css?f[]=satoshi@400,500&display=swap' }],
  ['link', { rel: 'stylesheet', href: 'https://fonts.googleapis.com/css2?family=JetBrains+Mono:wght@400;500&display=swap' }],
  ['meta', { name: 'theme-color', content: '#9333ea' }],
  ['meta', { name: 'og:type', content: 'website' }],
  ['meta', { name: 'og:locale', content: 'en' }],
  ['meta', { name: 'og:site_name', content: 'Lien' }],
  // Cloudflare Web Analytics
  [
    'script',
    {
      defer: '',
      src: 'https://static.cloudflareinsights.com/beacon.min.js',
      'data-cf-beacon': '{"token": "8ec4e997ac7a46a6a3049411d9583443"}',
    },
  ],
]

// https://vitepress.dev/reference/default-theme-config
const themeConfig: DefaultTheme.Config = {
  logo: '/logo.svg',

  nav: [
    { text: 'Guide', link: '/guide/' },
    { text: 'How It Works', link: '/how-it-works' },
    { text: 'Blog', link: '/blog/' },
    { text: 'GitHub', link: 'https://github.com/getlien/lien' },
  ],

  sidebar: {
    '/guide/': [
      {
        text: 'Getting Started',
        items: [
          { text: 'Introduction', link: '/guide/' },
          { text: 'Installation', link: '/guide/installation' },
          { text: 'Quick Start', link: '/guide/getting-started' },
          { text: 'Configuration', link: '/guide/configuration' },
        ],
      },
      {
        text: 'Usage',
        items: [
          { text: 'MCP Tools', link: '/guide/mcp-tools' },
          { text: 'Claude Code Plugin', link: '/guide/claude-code-plugin' },
          { text: 'Cross-Editor Agent Setup', link: '/guide/cross-editor-setup' },
          { text: 'CLI Commands', link: '/guide/cli-commands' },
          { text: 'Lien Review', link: '/guide/lien-review' },
          { text: 'Review Evidence', link: '/guide/review-evidence' },
          { text: 'Review Harness', link: '/guide/review-harness' },
        ],
      },
    ],
  },

  socialLinks: [{ icon: 'github', link: 'https://github.com/getlien/lien' }],

  footer: {
    message: 'Released under the AGPL-3.0 License. Free forever for local use.',
    copyright: 'Copyright © 2025 Alf Henderson',
  },

  search: {
    provider: 'local',
  },

  editLink: {
    pattern: 'https://github.com/getlien/lien/edit/main/packages/site/docs/:path',
    text: 'Edit this page on GitHub',
  },
}

// Mermaid config for better dark mode support
// https://mermaid.js.org/config/setup/modules/mermaidAPI.html#mermaidapi-configuration-defaults
const mermaidConfig = {
  theme: 'dark' as const,
  themeVariables: {
    darkMode: true,
    primaryColor: '#2d2d2d',
    primaryTextColor: '#e0e0e0',
    primaryBorderColor: '#a855f7',
    lineColor: '#a855f7',
    secondaryColor: '#3d3d3d',
    tertiaryColor: '#1e1e1e',
    background: '#1a1a1a',
    mainBkg: '#2d2d2d',
    secondBkg: '#3d3d3d',
    mainContrastColor: '#e0e0e0',
    darkTextColor: '#e0e0e0',
    border1: '#a855f7',
    border2: '#a855f7',
    fontSize: '16px',
  },
  flowchart: {
    curve: 'basis' as const,
    padding: 20,
    nodeSpacing: 100,
    rankSpacing: 100,
    htmlLabels: true,
  },
}

// https://vitepress.dev/reference/site-config
//
// Exported as a plain `UserConfigExport` function rather than through
// `defineConfig(...)` — `defineConfig`'s declared type only accepts a
// resolved config object, not the function form, even though VitePress
// (via Vite's own config loader) fully supports a config function that
// receives `{ command, mode }`. `defineConfig` is an identity function at
// runtime either way, so this only affects typing, not behavior.
const config: UserConfigExport<DefaultTheme.Config> = ({ command }) =>
  withMermaid({
    // Use /lien/ for GitHub Pages subdomain, / for custom domain
    base: process.env.VITE_BASE_PATH || '/',
    title: 'Lien',
    description: 'Local-first structural code search and dependency analysis for AI coding assistants',

    // Draft blog posts (frontmatter `draft: true`) render in `vitepress dev`
    // for owner review, but are fully excluded from the production build —
    // see docs/development/blog-authoring.md. `command === 'build'` is the
    // only production path; `dev`/`preview` both leave drafts visible.
    srcExclude: command === 'build' ? getDraftPostExcludes(srcDir) : [],

    head,
    themeConfig,
    mermaid: mermaidConfig,
  })

export default config
