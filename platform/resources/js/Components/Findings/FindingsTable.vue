<script setup>
import { computed } from 'vue';
import { Link } from '@inertiajs/vue3';
import { timeAgo } from '@/utils/runs';

const props = defineProps({
  findings: { type: Object, required: true },
});

const typeConfig = {
  bugs: { label: 'bug', color: 'bg-red-900/30 text-red-400' },
  architectural: { label: 'arch', color: 'bg-cyan-900/30 text-cyan-400' },
  complexity: { label: 'complexity', color: 'bg-amber-900/30 text-amber-400' },
  summary: { label: 'summary', color: 'bg-brand-900/30 text-brand-400' },
};

const resolutionConfig = {
  resolved: { label: 'Resolved', color: 'bg-green-900/30 text-green-400' },
  auto_resolved: { label: 'Auto-resolved', color: 'bg-green-900/30 text-green-400' },
  dismissed: { label: 'Dismissed', color: 'bg-zinc-800 text-zinc-400' },
};

function typeBadge(type) {
  return typeConfig[type] ?? { label: type, color: 'bg-zinc-800 text-zinc-400' };
}

const statusConfig = {
  posted: { label: 'Posted', color: 'bg-green-900/30 text-green-400' },
  suppressed: { label: 'Suppressed', color: 'bg-amber-900/30 text-amber-400' },
  skipped: { label: 'Skipped', color: 'bg-zinc-800 text-zinc-400' },
  deduped: { label: 'Deduped', color: 'bg-zinc-800 text-zinc-400' },
};

function statusLabel(finding) {
  if (finding.resolution) {
    return (
      resolutionConfig[finding.resolution] ?? {
        label: finding.resolution,
        color: 'bg-zinc-800 text-zinc-400',
      }
    );
  }
  return (
    statusConfig[finding.status] ?? { label: finding.status, color: 'bg-zinc-800 text-zinc-400' }
  );
}

function truncateBody(body, maxLen = 80) {
  if (!body) return '';
  const firstLine = body.split('\n')[0].replace(/^[#*\->\s]+/, '');
  return firstLine.length > maxLen ? firstLine.slice(0, maxLen) + '...' : firstLine;
}

const grouped = computed(() => {
  if (!props.findings?.data) return [];
  const groups = {};
  for (const finding of props.findings.data) {
    const key = finding.filepath || 'general';
    if (!groups[key]) {
      groups[key] = { filepath: key, findings: [] };
    }
    groups[key].findings.push(finding);
  }
  return Object.values(groups);
});
</script>

<template>
  <div>
    <div
      v-if="!findings?.data?.length"
      class="rounded-lg border border-zinc-800 bg-zinc-900 p-12 text-center"
    >
      <svg
        class="mx-auto h-10 w-10 text-zinc-500"
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
      <p class="mt-3 text-sm text-zinc-400">No findings match your filters.</p>
    </div>

    <div v-else class="overflow-hidden rounded-lg border border-zinc-800">
      <div v-for="(group, gi) in grouped" :key="group.filepath">
        <div
          :class="[
            'flex items-center justify-between bg-zinc-900 px-4 py-2',
            gi > 0 ? 'border-t border-zinc-800' : '',
          ]"
        >
          <span class="truncate font-mono text-xs text-zinc-400">{{ group.filepath }}</span>
          <span class="ml-2 shrink-0 text-xs text-zinc-500">({{ group.findings.length }})</span>
        </div>
        <div class="divide-y divide-zinc-800/50">
          <div
            v-for="finding in group.findings"
            :key="finding.id"
            class="flex items-center gap-3 bg-zinc-950 px-4 py-3 transition-colors hover:bg-zinc-800/50"
          >
            <span
              v-if="finding.line"
              class="w-10 shrink-0 text-right font-mono text-xs text-zinc-500"
            >
              L{{ finding.line }}
            </span>
            <span v-else class="w-10 shrink-0" />

            <span
              :class="[
                'rounded px-2 py-0.5 text-xs font-medium',
                typeBadge(finding.review_type).color,
              ]"
            >
              {{ typeBadge(finding.review_type).label }}
            </span>

            <span class="min-w-0 flex-1 truncate text-sm text-zinc-200">
              {{ truncateBody(finding.body) }}
            </span>

            <span
              v-if="finding.repository_name"
              class="hidden shrink-0 text-xs text-zinc-500 sm:block"
            >
              {{ finding.repository_name }}
            </span>

            <span v-if="finding.pr_number" class="hidden shrink-0 text-xs text-zinc-500 sm:block">
              PR #{{ finding.pr_number }}
            </span>

            <span
              :class="[
                'shrink-0 rounded px-2 py-0.5 text-xs font-medium',
                statusLabel(finding).color,
              ]"
            >
              {{ statusLabel(finding).label }}
            </span>

            <span class="hidden shrink-0 text-xs text-zinc-500 lg:block">
              {{ timeAgo(finding.created_at) }}
            </span>
          </div>
        </div>
      </div>

      <!-- Pagination -->
      <div
        v-if="findings.last_page > 1"
        class="flex items-center justify-between border-t border-zinc-800 bg-zinc-900 px-4 py-3"
      >
        <p class="text-xs text-zinc-400">
          Showing {{ findings.from }}–{{ findings.to }} of {{ findings.total }}
        </p>
        <div class="flex gap-1">
          <template v-for="link in findings.links" :key="link.label">
            <Link
              v-if="link.url"
              :href="link.url"
              :class="[
                'rounded px-3 py-1 text-xs font-medium transition-colors',
                link.active
                  ? 'bg-brand-950 text-brand-400'
                  : 'text-zinc-400 hover:bg-zinc-800 hover:text-zinc-200',
              ]"
              v-html="link.label"
              preserve-state
            />
            <span
              v-else
              class="cursor-default rounded px-3 py-1 text-xs font-medium text-zinc-600"
              v-html="link.label"
            />
          </template>
        </div>
      </div>
    </div>
  </div>
</template>
