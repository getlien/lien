<script setup>
defineProps({
  stats: {
    type: Object,
    required: true,
    // { totalRuns: number, findingsPosted: number, avgComplexity: number|null, totalCost: number, byType: { bugs: n, architectural: n, complexity: n, summary: n } }
  },
});

function formatCost(value) {
  return `$${Number(value).toFixed(2)}`;
}

function formatComplexity(value) {
  if (value === null || value === undefined) return '-';
  return Number(value).toFixed(1);
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
      type: 'architectural',
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
    <!-- Total Runs (7d) -->
    <div class="rounded-lg border border-zinc-800 bg-zinc-900 p-5">
      <p class="text-sm font-medium text-zinc-400">Runs (7d)</p>
      <p class="mt-2 text-3xl font-medium text-zinc-100">{{ stats.totalRuns ?? 0 }}</p>
    </div>

    <!-- Findings Posted -->
    <div class="rounded-lg border border-zinc-800 bg-zinc-900 p-5">
      <div class="flex items-center justify-between">
        <p class="text-sm font-medium text-zinc-400">Findings Posted</p>
      </div>
      <p class="mt-2 text-3xl font-medium text-zinc-100">{{ stats.findingsPosted ?? 0 }}</p>
      <!-- Type breakdown bar -->
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

    <!-- Avg Complexity -->
    <div class="rounded-lg border border-zinc-800 bg-zinc-900 p-5">
      <p class="text-sm font-medium text-zinc-400">Avg Complexity</p>
      <p class="mt-2 text-3xl font-medium text-zinc-100">
        {{ formatComplexity(stats.avgComplexity) }}
      </p>
    </div>

    <!-- Total Cost (7d) -->
    <div class="rounded-lg border border-zinc-800 bg-zinc-900 p-5">
      <p class="text-sm font-medium text-zinc-400">Cost (7d)</p>
      <p class="mt-2 text-3xl font-medium text-zinc-100">{{ formatCost(stats.totalCost ?? 0) }}</p>
    </div>
  </div>
</template>
