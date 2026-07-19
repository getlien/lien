<script setup>
import { computed } from 'vue'
import { useData } from 'vitepress'

const { frontmatter } = useData()

function formatDate(iso) {
  if (!iso) return ''
  const d = new Date(iso)
  if (Number.isNaN(d.getTime())) return String(iso)
  return d.toLocaleDateString('en-US', { year: 'numeric', month: 'long', day: 'numeric' })
}

// Array.isArray guard: a malformed `tags: foo` (a bare string, not a YAML
// list) would otherwise reach `v-for`, which iterates a string
// character-by-character in Vue — render garbage chips instead of that.
const tags = computed(() => (Array.isArray(frontmatter.value.tags) ? frontmatter.value.tags : []))
</script>

<template>
  <div v-if="frontmatter.date" class="lien-post-meta">
    <time :datetime="frontmatter.date">{{ formatDate(frontmatter.date) }}</time>
    <template v-if="frontmatter.author">
      <span class="lien-post-meta-sep">·</span>
      <span>{{ frontmatter.author }}</span>
    </template>
    <span v-if="tags.length" class="lien-post-meta-tags">
      <span v-for="tag in tags" :key="tag" class="lien-tag-chip">{{ tag }}</span>
    </span>
  </div>
</template>
