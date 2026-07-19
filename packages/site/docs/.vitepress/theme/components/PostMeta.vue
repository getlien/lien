<script setup>
import { useData } from 'vitepress'

const { frontmatter } = useData()

function formatDate(iso) {
  if (!iso) return ''
  const d = new Date(iso)
  if (Number.isNaN(d.getTime())) return String(iso)
  return d.toLocaleDateString('en-US', { year: 'numeric', month: 'long', day: 'numeric' })
}
</script>

<template>
  <div v-if="frontmatter.date" class="lien-post-meta">
    <time :datetime="frontmatter.date">{{ formatDate(frontmatter.date) }}</time>
    <template v-if="frontmatter.author">
      <span class="lien-post-meta-sep">·</span>
      <span>{{ frontmatter.author }}</span>
    </template>
    <span v-if="frontmatter.tags && frontmatter.tags.length" class="lien-post-meta-tags">
      <span v-for="tag in frontmatter.tags" :key="tag" class="lien-tag-chip">{{ tag }}</span>
    </span>
  </div>
</template>
