<script setup>
import { useData } from 'vitepress'

const { frontmatter } = useData()
</script>

<template>
  <div v-if="frontmatter.draft" class="lien-draft-banner" role="note">
    <span class="lien-draft-banner-badge">DRAFT</span>
    <span class="lien-draft-banner-text">
      Visible only in local dev — excluded from the production build
      (listing, nav, sitemap, and this page itself) until
      <code>draft: false</code> is set and merged to main.
    </span>
  </div>
</template>
