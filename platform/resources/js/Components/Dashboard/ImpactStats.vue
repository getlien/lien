<script setup>
defineProps({
  stats: {
    type: Object,
    required: true,
  },
});

function formatCost(value) {
  return `$${Number(value).toFixed(2)}`;
}

function typeBarSegments(byType) {
  if (!byType) return [];
  const total =
    (byType.bugs ?? 0) +
    (byType.architectural ?? 0) +
    (byType.complexity ?? 0) +
    (byType.summary ?? 0);
  if (total === 0) return [];

  const segments = [];
  if (byType.bugs > 0)
    segments.push({
      type: 'bugs',
      count: byType.bugs,
      pct: (byType.bugs / total) * 100,
      color: 'bg-red-500',
    });
  if (byType.architectural > 0)
    segments.push({
      type: 'arch',
      count: byType.architectural,
      pct: (byType.architectural / total) * 100,
      color: 'bg-cyan-500',
    });
  if (byType.complexity > 0)
    segments.push({
      type: 'complexity',
      count: byType.complexity,
      pct: (byType.complexity / total) * 100,
      color: 'bg-amber-500',
    });
  if (byType.summary > 0)
    segments.push({
      type: 'summary',
      count: byType.summary,
      pct: (byType.summary / total) * 100,
      color: 'bg-brand-500',
    });
  return segments;
}
</script>

<template>
  <div class="grid grid-cols-2 gap-4 lg:grid-cols-4">
    <div class="rounded-lg border border-zinc-800 bg-zinc-900 p-5">
      <p class="text-sm font-medium text-zinc-400">PRs Reviewed</p>
      <p class="mt-2 text-3xl font-medium text-zinc-100">{{ stats.prsReviewed ?? 0 }}</p>
    </div>

    <div class="rounded-lg border border-zinc-800 bg-zinc-900 p-5">
      <p class="text-sm font-medium text-zinc-400">Findings Posted</p>
      <p class="mt-2 text-3xl font-medium text-zinc-100">{{ stats.findingsPosted ?? 0 }}</p>
      <div v-if="typeBarSegments(stats.byType).length" class="mt-3">
        <div class="flex h-1.5 overflow-hidden rounded-full bg-zinc-800">
          <div
            v-for="seg in typeBarSegments(stats.byType)"
            :key="seg.type"
            :class="[seg.color, 'transition-all duration-500']"
            :style="{ width: `${seg.pct}%` }"
            :title="`${seg.type}: ${seg.count}`"
          />
        </div>
        <div class="mt-2 flex flex-wrap gap-x-3 gap-y-1">
          <span
            v-for="seg in typeBarSegments(stats.byType)"
            :key="seg.type"
            class="flex items-center gap-1.5 text-xs text-zinc-400"
          >
            <span :class="[seg.color, 'inline-block h-2 w-2 rounded-full']" />
            {{ seg.count }} {{ seg.type }}
          </span>
        </div>
      </div>
    </div>

    <div class="rounded-lg border border-zinc-800 bg-zinc-900 p-5">
      <p class="text-sm font-medium text-zinc-400">Resolution Rate</p>
      <p class="mt-2 text-3xl font-medium text-zinc-100">{{ stats.resolutionRate ?? 0 }}%</p>
    </div>

    <div class="rounded-lg border border-zinc-800 bg-zinc-900 p-5">
      <p class="text-sm font-medium text-zinc-400">Total Cost</p>
      <p class="mt-2 text-3xl font-medium text-zinc-100">{{ formatCost(stats.totalCost ?? 0) }}</p>
    </div>
  </div>
</template>
