<script setup>
import { Link } from '@inertiajs/vue3';

defineProps({
  items: {
    type: Array,
    required: true,
    // Each item: { label: string, href?: string }
  },
});
</script>

<template>
  <nav aria-label="Breadcrumb" class="flex items-center gap-1.5 text-sm">
    <template v-for="(item, i) in items" :key="i">
      <svg
        v-if="i > 0"
        class="h-3.5 w-3.5 shrink-0 text-zinc-600"
        fill="none"
        viewBox="0 0 24 24"
        stroke="currentColor"
        stroke-width="2"
        aria-hidden="true"
      >
        <path stroke-linecap="round" stroke-linejoin="round" d="M8.25 4.5l7.5 7.5-7.5 7.5" />
      </svg>
      <Link
        v-if="item.href && i < items.length - 1"
        :href="item.href"
        class="truncate text-zinc-400 transition-colors hover:text-zinc-200"
      >
        {{ item.label }}
      </Link>
      <span
        v-else
        class="truncate text-zinc-200"
        :aria-current="i === items.length - 1 ? 'page' : undefined"
      >
        {{ item.label }}
      </span>
    </template>
  </nav>
</template>
