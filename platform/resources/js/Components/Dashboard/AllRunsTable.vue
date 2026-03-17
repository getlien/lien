<script setup>
import { Link } from '@inertiajs/vue3'
import CopyableCode from '@/Components/CopyableCode.vue'
import { statusBadge, formatDuration, timeAgo, formatFullDate } from '@/utils/runs'

const props = defineProps({
    runs: Object,
    filters: Object,
})
</script>

<template>
    <div>
        <div class="overflow-hidden rounded-lg border border-zinc-800 bg-zinc-900">
            <div class="overflow-x-auto">
                <table class="min-w-full divide-y divide-zinc-800" aria-label="All review runs">
                    <thead>
                        <tr>
                            <th scope="col" class="px-6 py-3 text-left text-xs font-medium text-zinc-400">Repository</th>
                            <th scope="col" class="px-6 py-3 text-left text-xs font-medium text-zinc-400">Run</th>
                            <th scope="col" class="px-6 py-3 text-left text-xs font-medium text-zinc-400">Status</th>
                            <th scope="col" class="px-6 py-3 text-right text-xs font-medium text-zinc-400">Complexity</th>
                            <th scope="col" class="px-6 py-3 text-right text-xs font-medium text-zinc-400">Duration</th>
                            <th scope="col" class="px-6 py-3 text-right text-xs font-medium text-zinc-400">When</th>
                        </tr>
                    </thead>
                    <tbody class="divide-y divide-zinc-800">
                        <tr v-for="run in runs.data" :key="run.id" class="transition-colors hover:bg-zinc-800/50">
                            <td class="whitespace-nowrap px-6 py-4 text-sm">
                                <Link
                                    :href="`/repos/${run.repository_id}/dashboard`"
                                    class="font-medium text-zinc-200 hover:text-brand-400"
                                >
                                    {{ run.repository_name }}
                                </Link>
                            </td>
                            <td class="px-6 py-4 text-sm">
                                <div class="flex items-center gap-2">
                                    <Link
                                        :href="`/repos/${run.repository_id}/runs/${run.id}`"
                                        class="font-medium text-brand-400 hover:text-brand-300"
                                    >
                                        {{ run.type === 'baseline' ? 'Baseline' : `PR #${run.pr_number}` }}
                                    </Link>
                                    <CopyableCode v-if="run.head_sha" :text="run.head_sha" class="ml-1" />
                                </div>
                                <p v-if="run.pr_title" class="mt-0.5 max-w-xs truncate text-xs text-zinc-400" :title="run.pr_title">
                                    {{ run.pr_title }}
                                </p>
                                <p v-else-if="run.head_ref" class="mt-0.5 max-w-xs truncate font-mono text-xs text-zinc-500" :title="run.head_ref">
                                    {{ run.head_ref }}
                                </p>
                            </td>
                            <td class="whitespace-nowrap px-6 py-4">
                                <span :class="['inline-flex rounded px-2 py-0.5 text-xs font-medium', statusBadge(run.status)]">
                                    {{ run.status }}
                                </span>
                            </td>
                            <td class="whitespace-nowrap px-6 py-4 text-right text-sm text-zinc-400">
                                {{ run.avg_complexity != null ? run.avg_complexity.toFixed(1) : '—' }}
                            </td>
                            <td class="whitespace-nowrap px-6 py-4 text-right text-sm text-zinc-400">
                                {{ formatDuration(run.duration_seconds) }}
                            </td>
                            <td class="whitespace-nowrap px-6 py-4 text-right text-sm text-zinc-400" :title="formatFullDate(run.created_at)">
                                {{ timeAgo(run.created_at) }}
                            </td>
                        </tr>
                        <tr v-if="!runs.data?.length">
                            <td colspan="6" class="px-6 py-8 text-center text-sm text-zinc-400">
                                <svg v-if="filters?.type || filters?.status || filters?.repo" class="mx-auto h-10 w-10 text-zinc-500" fill="none" viewBox="0 0 24 24" stroke="currentColor" stroke-width="1" aria-hidden="true">
                                    <path stroke-linecap="round" stroke-linejoin="round" d="M21 21l-6-6m2-5a7 7 0 11-14 0 7 7 0 0114 0z" />
                                </svg>
                                <svg v-else class="mx-auto h-10 w-10 text-zinc-500" fill="none" viewBox="0 0 24 24" stroke="currentColor" stroke-width="1" aria-hidden="true">
                                    <path stroke-linecap="round" stroke-linejoin="round" d="M9 5H7a2 2 0 00-2 2v12a2 2 0 002 2h10a2 2 0 002-2V7a2 2 0 00-2-2h-2M9 5a2 2 0 002 2h2a2 2 0 002-2M9 5a2 2 0 012-2h2a2 2 0 012 2" />
                                </svg>
                                <p class="mt-2">
                                    {{ (filters?.type || filters?.status || filters?.repo) ? 'No runs match your filters.' : 'No review runs yet.' }}
                                </p>
                            </td>
                        </tr>
                    </tbody>
                </table>
            </div>
        </div>

        <div v-if="runs.last_page > 1" class="mt-4 flex items-center justify-between">
            <p class="text-sm text-zinc-400">
                Showing {{ runs.from }}&ndash;{{ runs.to }} of {{ runs.total }}
            </p>
            <div class="flex gap-2">
                <component
                    :is="link.url ? Link : 'span'"
                    v-for="(link, index) in runs.links"
                    :key="link.url || 'page-' + index"
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
