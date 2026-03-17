<script setup>
import { ref, computed } from 'vue'
import { Link } from '@inertiajs/vue3'
import CopyableCode from '@/Components/CopyableCode.vue'
import SparklineChart from '@/Components/Charts/SparklineChart.vue'
import { statusBadge, timeAgo, formatFullDate, formatDelta, deltaColor } from '@/utils/runs'

const props = defineProps({
    group: { type: Object, required: true },
    repositoryId: { type: Number, required: true },
})

const expanded = ref(false)

const sparklineData = computed(() =>
    props.group.evolution
        .slice()
        .reverse()
        .map(e => e.avg_complexity)
        .filter(v => v != null),
)

const firstComplexity = computed(() => sparklineData.value.length >= 2 ? sparklineData.value[0] : null)
const lastComplexity = computed(() => sparklineData.value.length >= 2 ? sparklineData.value[sparklineData.value.length - 1] : null)
const hasEvolution = computed(() => sparklineData.value.length >= 2)
</script>

<template>
    <tr
        class="transition-colors hover:bg-zinc-800/50"
        :class="{ 'cursor-pointer': group.runs_count > 1 }"
        @click="group.runs_count > 1 && (expanded = !expanded)"
    >
        <td class="px-6 py-4 text-sm">
            <Link
                :href="`/repos/${repositoryId}/runs/${group.latest_run_id}`"
                class="font-medium text-brand-400 hover:text-brand-300"
                @click.stop
            >
                PR #{{ group.pr_number }}
            </Link>
            <p v-if="group.pr_title" class="mt-0.5 max-w-xs truncate text-xs text-zinc-400" :title="group.pr_title">
                {{ group.pr_title }}
            </p>
            <p v-if="group.head_ref" class="mt-0.5 max-w-xs truncate font-mono text-xs text-zinc-500" :title="`${group.head_ref} → ${group.base_ref}`">
                {{ group.head_ref }}<span class="text-zinc-600"> &rarr; </span>{{ group.base_ref }}
            </p>
        </td>
        <td class="whitespace-nowrap px-6 py-4 text-sm text-zinc-400">
            <span class="inline-flex items-center gap-1.5 rounded bg-zinc-800 px-2 py-0.5 text-xs font-medium text-zinc-300">
                {{ group.runs_count }} {{ group.runs_count === 1 ? 'run' : 'runs' }}
            </span>
        </td>
        <td class="whitespace-nowrap px-6 py-4">
            <span :class="['inline-flex rounded px-2 py-0.5 text-xs font-medium', statusBadge(group.latest_status)]">
                {{ group.latest_status }}
            </span>
        </td>
        <td class="px-6 py-4">
            <SparklineChart :data="sparklineData" />
        </td>
        <td class="whitespace-nowrap px-6 py-4 text-right text-sm">
            <template v-if="hasEvolution && group.delta.avg_complexity_change != null">
                <span class="text-zinc-400">{{ firstComplexity }}</span>
                <span class="text-zinc-600"> &rarr; </span>
                <span class="text-zinc-200">{{ lastComplexity }}</span>
                <span :class="['ml-1.5 text-xs', deltaColor(group.delta.avg_complexity_change)]">
                    {{ formatDelta(group.delta.avg_complexity_change) }}
                </span>
            </template>
            <span v-else class="text-zinc-500">&mdash;</span>
        </td>
        <td class="whitespace-nowrap px-6 py-4 text-right text-sm text-zinc-400" :title="formatFullDate(group.latest_run_at)">
            {{ timeAgo(group.latest_run_at) }}
        </td>
        <td class="w-8 px-3 py-4 text-center">
            <button
                v-if="group.runs_count > 1"
                class="text-zinc-500 transition-transform hover:text-zinc-300"
                :class="{ 'rotate-90': expanded }"
                :aria-label="expanded ? 'Collapse runs' : 'Expand runs'"
                :aria-expanded="expanded"
                type="button"
                @click.stop="expanded = !expanded"
            >
                <svg class="h-4 w-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" stroke-width="1.5" aria-hidden="true">
                    <path stroke-linecap="round" stroke-linejoin="round" d="M8.25 4.5l7.5 7.5-7.5 7.5" />
                </svg>
            </button>
        </td>
    </tr>

    <tr v-if="expanded">
        <td colspan="7" class="p-0">
            <div class="border-l-2 border-brand-500/20 ml-6">
                <table class="w-full">
                    <tbody class="divide-y divide-zinc-800/50">
                        <tr
                            v-for="run in group.runs"
                            :key="run.id"
                            class="transition-colors hover:bg-zinc-800/30"
                        >
                            <td class="whitespace-nowrap py-2.5 pl-4 pr-6 text-sm">
                                <Link
                                    :href="`/repos/${repositoryId}/runs/${run.id}`"
                                    class="text-brand-400 hover:text-brand-300"
                                >
                                    #{{ run.id }}
                                </Link>
                                <CopyableCode v-if="run.head_sha" :text="run.head_sha" class="ml-2" />
                            </td>
                            <td class="whitespace-nowrap px-6 py-2.5">
                                <span :class="['inline-flex rounded px-2 py-0.5 text-xs font-medium', statusBadge(run.status)]">
                                    {{ run.status }}
                                </span>
                            </td>
                            <td class="whitespace-nowrap px-6 py-2.5 text-sm text-zinc-400">
                                {{ run.avg_complexity != null ? run.avg_complexity : '—' }}
                            </td>
                            <td class="whitespace-nowrap px-6 py-2.5 text-sm text-zinc-400">
                                {{ run.comments_posted_count }} {{ run.comments_posted_count === 1 ? 'comment' : 'comments' }}
                            </td>
                            <td class="whitespace-nowrap px-6 py-2.5 text-right text-sm text-zinc-500" :title="formatFullDate(run.created_at)">
                                {{ timeAgo(run.created_at) }}
                            </td>
                        </tr>
                    </tbody>
                </table>
            </div>
        </td>
    </tr>
</template>
