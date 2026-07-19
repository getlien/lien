---
title: Blog
description: Notes on building Lien — local-first code intelligence for AI agents.
---

<script setup>
import { data as posts } from './posts.data.ts'

function formatDate(iso) {
  if (!iso) return ''
  const d = new Date(iso)
  if (Number.isNaN(d.getTime())) return String(iso)
  return d.toLocaleDateString('en-US', { year: 'numeric', month: 'long', day: 'numeric' })
}
</script>

# Blog

<p v-if="!posts.length" class="lien-blog-empty">
  Nothing published yet — check back soon.
</p>

<div v-else class="lien-blog-index">
  <a
    v-for="post in posts"
    :key="post.url"
    :href="post.url"
    class="lien-blog-card"
    :class="{ 'is-draft': post.draft }"
  >
    <div class="lien-blog-card-meta">
      <time :datetime="post.date">{{ formatDate(post.date) }}</time>
      <span v-if="post.draft" class="lien-draft-chip">DRAFT</span>
    </div>
    <h2 class="lien-blog-card-title">{{ post.title }}</h2>
    <p class="lien-blog-card-desc">{{ post.description }}</p>
    <div v-if="post.tags.length" class="lien-blog-card-tags">
      <span v-for="tag in post.tags" :key="tag" class="lien-tag-chip">{{ tag }}</span>
    </div>
  </a>
</div>
