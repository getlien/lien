<script setup>
defineProps({
  summary: {
    type: Object,
    required: true,
  },
});
</script>

<template>
  <div class="grid grid-cols-2 gap-4 sm:grid-cols-4">
    <div class="rounded-lg border border-zinc-800 bg-zinc-900 p-4">
      <p class="text-xs font-medium tracking-wide text-zinc-400">Posted</p>
      <p class="mt-1 text-2xl font-medium text-zinc-100">{{ summary.posted ?? 0 }}</p>
    </div>
    <div class="rounded-lg border border-zinc-800 bg-zinc-900 p-4">
      <p class="text-xs font-medium tracking-wide text-zinc-400">Resolved</p>
      <p class="mt-1 text-2xl font-medium text-green-400">{{ summary.resolved ?? 0 }}</p>
    </div>
    <div class="rounded-lg border border-zinc-800 bg-zinc-900 p-4">
      <p class="text-xs font-medium tracking-wide text-zinc-400">Dismissed</p>
      <p class="mt-1 text-2xl font-medium text-zinc-400">{{ summary.dismissed ?? 0 }}</p>
    </div>
    <div class="rounded-lg border border-zinc-800 bg-zinc-900 p-4">
      <p class="text-xs font-medium tracking-wide text-zinc-400">Open</p>
      <p class="mt-1 text-2xl font-medium text-amber-400">{{ summary.open ?? 0 }}</p>
    </div>
  </div>
</template>
