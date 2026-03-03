import { defineConfig } from 'vitepress'
import { withMermaid } from 'vitepress-plugin-mermaid'

// https://vitepress.dev/reference/site-config
export default withMermaid(
  defineConfig({
    // Use /lien/ for GitHub Pages subdomain, / for custom domain
    base: process.env.VITE_BASE_PATH || '/',
    title: 'Lien',
    description: 'Local-first semantic code search for AI assistants',
    
    head: [
      ['link', { rel: 'icon', type: 'image/svg+xml', href: '/favicon.svg' }],
      ['link', { rel: 'stylesheet', href: 'https://api.fontshare.com/v2/css?f[]=satoshi@400,500&display=swap' }],
      ['link', { rel: 'stylesheet', href: 'https://fonts.googleapis.com/css2?family=JetBrains+Mono:wght@400;500&display=swap' }],
      ['meta', { name: 'theme-color', content: '#9333ea' }],
      ['meta', { name: 'og:type', content: 'website' }],
      ['meta', { name: 'og:locale', content: 'en' }],
      ['meta', { name: 'og:site_name', content: 'Lien' }],
      // Cloudflare Web Analytics
      ['script', { 
        defer: '', 
        src: 'https://static.cloudflareinsights.com/beacon.min.js',
        'data-cf-beacon': '{"token": "8ec4e997ac7a46a6a3049411d9583443"}'
      }],
    ],

    themeConfig: {
      // https://vitepress.dev/reference/default-theme-config
      logo: '/logo.svg',
      
      nav: [
        { text: 'Guide', link: '/guide/' },
        { text: 'How It Works', link: '/how-it-works' },
        { text: 'GitHub', link: 'https://github.com/getlien/lien' }
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
            ]
          },
          {
            text: 'Usage',
            items: [
              { text: 'MCP Tools', link: '/guide/mcp-tools' },
              { text: 'CLI Commands', link: '/guide/cli-commands' },
            ]
          },
        ]
      },

      socialLinks: [
        { icon: 'github', link: 'https://github.com/getlien/lien' }
      ],

      footer: {
        message: 'Released under the AGPL-3.0 License. Free forever for local use.',
        copyright: 'Copyright © 2025 Alf Henderson'
      },

      search: {
        provider: 'local'
      },

      editLink: {
        pattern: 'https://github.com/getlien/lien/edit/main/packages/site/docs/:path',
        text: 'Edit this page on GitHub'
      }
    },

    // Mermaid config for better dark mode support
    mermaid: {
      // https://mermaid.js.org/config/setup/modules/mermaidAPI.html#mermaidapi-configuration-defaults
      theme: 'dark',
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
        fontSize: '16px'
      },
      flowchart: {
        curve: 'basis',
        padding: 20,
        nodeSpacing: 100,
        rankSpacing: 100,
        htmlLabels: true
      }
    }
  })
)
