<script setup>
const props = defineProps({
  filters: { type: Object, required: true },
  repositories: { type: Array, default: () => [] },
  showRepoFilter: { type: Boolean, default: true },
});

const emit = defineEmits(['filter']);

function update(key, value) {
  emit('filter', key, value || null);
}
</script>

<template>
  <div class="flex flex-wrap gap-3">
    <select
      :value="filters.type || ''"
      class="rounded-md border border-zinc-800 bg-zinc-900 px-3 py-2 text-sm text-zinc-200 focus:border-brand-500 focus:ring-1 focus:ring-brand-500/20"
      @change="update('type', $event.target.value)"
    >
      <option value="">All Types</option>
      <option value="bugs">Bugs</option>
      <option value="architectural">Architectural</option>
      <option value="complexity">Complexity</option>
      <option value="summary">Summary</option>
    </select>

    <select
      :value="filters.status || 'posted'"
      class="rounded-md border border-zinc-800 bg-zinc-900 px-3 py-2 text-sm text-zinc-200 focus:border-brand-500 focus:ring-1 focus:ring-brand-500/20"
      @change="update('status', $event.target.value)"
    >
      <option value="posted">Posted</option>
      <option value="all">All Statuses</option>
      <option value="suppressed">Suppressed</option>
      <option value="skipped">Skipped</option>
    </select>

    <select
      :value="filters.resolution || ''"
      class="rounded-md border border-zinc-800 bg-zinc-900 px-3 py-2 text-sm text-zinc-200 focus:border-brand-500 focus:ring-1 focus:ring-brand-500/20"
      @change="update('resolution', $event.target.value)"
    >
      <option value="">All Resolutions</option>
      <option value="open">Open</option>
      <option value="resolved">Resolved</option>
      <option value="auto_resolved">Auto-resolved</option>
      <option value="dismissed">Dismissed</option>
    </select>

    <select
      v-if="showRepoFilter && repositories.length > 1"
      :value="filters.repo || ''"
      class="rounded-md border border-zinc-800 bg-zinc-900 px-3 py-2 text-sm text-zinc-200 focus:border-brand-500 focus:ring-1 focus:ring-brand-500/20"
      @change="update('repo', $event.target.value)"
    >
      <option value="">All Repos</option>
      <option v-for="repo in repositories" :key="repo.id" :value="repo.id">
        {{ repo.full_name }}
      </option>
    </select>

    <select
      :value="filters.range || ''"
      class="rounded-md border border-zinc-800 bg-zinc-900 px-3 py-2 text-sm text-zinc-200 focus:border-brand-500 focus:ring-1 focus:ring-brand-500/20"
      @change="update('range', $event.target.value)"
    >
      <option value="">All Time</option>
      <option value="7">Last 7 days</option>
      <option value="30">Last 30 days</option>
      <option value="90">Last 90 days</option>
    </select>
  </div>
</template>
