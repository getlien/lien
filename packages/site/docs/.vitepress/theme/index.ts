// .vitepress/theme/index.ts
import DefaultTheme from 'vitepress/theme'
import './custom.css'
import InteractiveBackground from './components/InteractiveBackground.vue'
import DraftBanner from './components/DraftBanner.vue'
import DeprecationBanner from './components/DeprecationBanner.vue'
import PostMeta from './components/PostMeta.vue'
import { h } from 'vue'

export default {
  extends: DefaultTheme,
  Layout() {
    return h(DefaultTheme.Layout, null, {
      'layout-top': () => h(InteractiveBackground),
      // Renders inside `.vp-doc`, right before a page's content — DraftBanner
      // shows only when frontmatter.draft is true (blog drafts, dev only);
      // PostMeta shows only when frontmatter.date is present (blog posts).
      'home-hero-before': () => h('div', { class: 'lien-deprecation-home' }, [h(DeprecationBanner)]),
      'doc-before': () => [h(DeprecationBanner), h(DraftBanner), h(PostMeta)]
    })
  }
}


