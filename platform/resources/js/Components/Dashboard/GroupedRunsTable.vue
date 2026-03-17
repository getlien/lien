<script setup>
import { Link } from '@inertiajs/vue3'
import SparklineChart from '@/Components/Charts/SparklineChart.vue'
import { statusBadge, timeAgo, formatFullDate, complexityDelta, deltaColor } from '@/utils/runs'

const props = defineProps({
    groups: Object,
    filters: Object,
})
</script>

<template>
    <div>
        <div class="overflow-hidden rounded-lg border border-zinc-800 bg-zinc-900">
            <div class="overflow-x-auto">
                <table class="min-w-full divide-y divide-zinc-800" aria-label="Review runs grouped by pull request">
                    <thead>
                        <tr>
                            <th scope="col" class="px-6 py-3 text-left text-xs font-medium text-zinc-400">Pull request</th>
                            <th scope="col" class="px-6 py-3 text-left text-xs font-medium text-zinc-400">Repository</th>
                            <th scope="col" class="px-6 py-3 text-right text-xs font-medium text-zinc-400">Runs</th>
                            <th scope="col" class="px-6 py-3 text-left text-xs font-medium text-zinc-400">Status</th>
                            <th scope="col" class="px-6 py-3 text-left text-xs font-medium text-zinc-400">Trend</th>
                            <th scope="col" class="px-6 py-3 text-right text-xs font-medium text-zinc-400">Complexity</th>
                            <th scope="col" class="px-6 py-3 text-right text-xs font-medium text-zinc-400">When</th>
                        </tr>
                    </thead>
                    <tbody class="divide-y divide-zinc-800">
                        <tr v-for="group in groups.data" :key="`${group.repository_id}:${group.type}:${group.pr_number}`" class="transition-colors hover:bg-zinc-800/50">
                            <td class="px-6 py-4 text-sm">
                                <Link
                                    :href="`/repos/${group.repository_id}/runs/${group.latest_run_id}`"
                                    class="font-medium text-brand-400 hover:text-brand-300"
                                >
                                    {{ group.type === 'baseline' ? 'Baseline' : `PR #${group.pr_number}` }}
                                </Link>
                                <p v-if="group.pr_title" class="mt-0.5 max-w-xs truncate text-xs text-zinc-400" :title="group.pr_title">
                                    {{ group.pr_title }}
                                </p>
                                <p v-if="group.head_ref" class="mt-0.5 max-w-xs truncate font-mono text-xs text-zinc-500" :title="`${group.head_ref} → ${group.base_ref}`">
                                    {{ group.head_ref }}<span class="text-zinc-600"> &rarr; </span>{{ group.base_ref }}
                                </p>
                            </td>
                            <td class="whitespace-nowrap px-6 py-4 text-sm">
                                <Link
                                    :href="`/repos/${group.repository_id}/dashboard`"
                                    class="text-zinc-400 hover:text-brand-400"
                                >
                                    {{ group.repository_name }}
                                </Link>
                            </td>
                            <td class="whitespace-nowrap px-6 py-4 text-right text-sm text-zinc-400">
                                {{ group.runs_count }} {{ group.runs_count === 1 ? 'run' : 'runs' }}
                            </td>
                            <td class="whitespace-nowrap px-6 py-4">
                                <span :class="['inline-flex rounded px-2 py-0.5 text-xs font-medium', statusBadge(group.latest_status)]">
                                    {{ group.latest_status }}
                                </span>
                            </td>
                            <td class="px-6 py-4">
                                <SparklineChart :data="group.trend_data" />
                            </td>
                            <td class="whitespace-nowrap px-6 py-4 text-right text-sm">
                                <span v-if="group.latest_avg_complexity != null" class="text-zinc-200">
                                    {{ group.latest_avg_complexity.toFixed(1) }}
                                </span>
                                <span v-else class="text-zinc-500">&mdash;</span>
                                <span
                                    v-if="complexityDelta(group.complexity_delta)"
                                    :class="['ml-1.5 text-xs', deltaColor(group.complexity_delta)]"
                                >
                                    {{ complexityDelta(group.complexity_delta) }}
                                </span>
                            </td>
                            <td class="whitespace-nowrap px-6 py-4 text-right text-sm text-zinc-400" :title="formatFullDate(group.last_run_at)">
                                {{ timeAgo(group.last_run_at) }}
                            </td>
                        </tr>
                        <tr v-if="!groups.data?.length">
                            <td colspan="7" class="px-6 py-8 text-center text-sm text-zinc-400">
                                <svg v-if="filters?.status || filters?.repo" class="mx-auto h-10 w-10 text-zinc-500" fill="none" viewBox="0 0 24 24" stroke="currentColor" stroke-width="1" aria-hidden="true">
                                    <path stroke-linecap="round" stroke-linejoin="round" d="M21 21l-6-6m2-5a7 7 0 11-14 0 7 7 0 0114 0z" />
                                </svg>
                                <svg v-else class="mx-auto h-10 w-10 text-zinc-500" fill="none" viewBox="0 0 24 24" stroke="currentColor" stroke-width="1" aria-hidden="true">
                                    <path stroke-linecap="round" stroke-linejoin="round" d="M9 5H7a2 2 0 00-2 2v12a2 2 0 002 2h10a2 2 0 002-2V7a2 2 0 00-2-2h-2M9 5a2 2 0 002 2h2a2 2 0 002-2M9 5a2 2 0 012-2h2a2 2 0 012 2" />
                                </svg>
                                <p class="mt-2">
                                    {{ (filters?.status || filters?.repo) ? 'No runs match your filters.' : 'No review runs yet.' }}
                                </p>
                            </td>
                        </tr>
                    </tbody>
                </table>
            </div>
        </div>

        <div v-if="groups.last_page > 1" class="mt-4 flex items-center justify-between">
            <p class="text-sm text-zinc-400">
                Showing {{ groups.from }}&ndash;{{ groups.to }} of {{ groups.total }}
            </p>
            <div class="flex gap-2">
                <component
                    :is="link.url ? Link : 'span'"
                    v-for="(link, index) in groups.links"
                    :key="`${link.label}-${link.url ?? index}`"
                    :href="link.url || undefined"
                    :class="[
                        'rounded-md border px-3 py-1.5 text-sm',
                        link.active
                            ? 'border-brand-500 bg-brand-950 font-medium text-brand-400'
                            : link.url
                                ? 'border-zinc-700 text-zinc-300 hover:bg-zinc-800/50'
                                : 'border-zinc-800 text-zinc-600',
                    ]"
                    v-html="link.label"
                />
            </div>
        </div>
    </div>
</template>
