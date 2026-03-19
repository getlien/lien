<script setup>
import { timeAgo } from '@/utils/runs';

defineProps({
  findings: { type: Array, required: true },
});

const typeConfig = {
  bugs: { label: 'bug', color: 'bg-red-900/30 text-red-400' },
  architectural: { label: 'arch', color: 'bg-cyan-900/30 text-cyan-400' },
  complexity: { label: 'complexity', color: 'bg-amber-900/30 text-amber-400' },
  summary: { label: 'summary', color: 'bg-brand-900/30 text-brand-400' },
};

function typeBadge(type) {
  return typeConfig[type] ?? { label: type, color: 'bg-zinc-800 text-zinc-400' };
}

function truncateBody(body, maxLen = 60) {
  if (!body) return '';
  const firstLine = body.split('\n')[0].replace(/^[#*\->\s]+/, '');
  return firstLine.length > maxLen ? firstLine.slice(0, maxLen) + '...' : firstLine;
}
</script>

<template>
  <div
    v-if="!findings.length"
    class="rounded-lg border border-zinc-800 bg-zinc-900 p-8 text-center"
  >
    <svg
      class="mx-auto h-8 w-8 text-zinc-500"
      fill="none"
      viewBox="0 0 24 24"
      stroke="currentColor"
      stroke-width="1"
      aria-hidden="true"
    >
      <path
        stroke-linecap="round"
        stroke-linejoin="round"
        d="M2.036 12.322a1.012 1.012 0 010-.639C3.423 7.51 7.36 4.5 12 4.5c4.638 0 8.573 3.007 9.963 7.178.07.207.07.431 0 .639C20.577 16.49 16.64 19.5 12 19.5c-4.638 0-8.573-3.007-9.963-7.178z"
      />
      <path stroke-linecap="round" stroke-linejoin="round" d="M15 12a3 3 0 11-6 0 3 3 0 016 0z" />
    </svg>
    <p class="mt-2 text-sm text-zinc-400">No findings yet. Run a review to see results.</p>
  </div>

  <div v-else class="overflow-hidden rounded-lg border border-zinc-800">
    <div class="divide-y divide-zinc-800/50">
      <div
        v-for="finding in findings"
        :key="finding.id"
        class="flex items-center gap-3 bg-zinc-950 px-4 py-3 transition-colors hover:bg-zinc-800/50"
      >
        <span v-if="finding.repository_name" class="hidden shrink-0 text-xs text-zinc-500 sm:block">
          {{ finding.repository_name }}
        </span>

        <span v-if="finding.pr_number" class="shrink-0 text-xs text-zinc-400">
          PR #{{ finding.pr_number }}
        </span>

        <span
          :class="[
            'shrink-0 rounded px-2 py-0.5 text-xs font-medium',
            typeBadge(finding.review_type).color,
          ]"
        >
          {{ typeBadge(finding.review_type).label }}
        </span>

        <span class="min-w-0 flex-1 truncate text-sm text-zinc-200">
          {{ truncateBody(finding.body) }}
        </span>

        <span class="hidden shrink-0 text-xs text-zinc-500 lg:block">
          {{ timeAgo(finding.created_at) }}
        </span>
      </div>
    </div>
  </div>
</template>
