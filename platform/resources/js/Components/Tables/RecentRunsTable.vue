<script setup>
import { Link } from '@inertiajs/vue3'
import CopyableCode from '@/Components/CopyableCode.vue'
import { statusBadge, formatDuration, timeAgo, formatFullDate, runLabel } from '@/utils/runs'

defineProps({
    runs: { type: Array, default: () => [] },
    repositoryId: { type: Number, required: true },
})
</script>

<template>
    <div class="rounded-lg border border-zinc-800 bg-zinc-900">
        <div class="p-5 pb-0">
            <h3 class="text-lg font-medium text-zinc-100">Recent Runs</h3>
        </div>
        <div class="mt-4 overflow-x-auto">
            <table class="min-w-full divide-y divide-zinc-800" aria-label="Recent review runs">
                <thead>
                    <tr>
                        <th scope="col" class="px-6 py-3 text-left text-xs font-medium text-zinc-400">Run</th>
                        <th scope="col" class="px-6 py-3 text-left text-xs font-medium text-zinc-400">Type</th>
                        <th scope="col" class="px-6 py-3 text-left text-xs font-medium text-zinc-400">Status</th>
                        <th scope="col" class="px-6 py-3 text-right text-xs font-medium text-zinc-400">Duration</th>
                        <th scope="col" class="px-6 py-3 text-right text-xs font-medium text-zinc-400">When</th>
                    </tr>
                </thead>
                <tbody class="divide-y divide-zinc-800">
                    <tr v-for="run in runs" :key="run.id" class="transition-colors hover:bg-zinc-800/50">
                        <td class="whitespace-nowrap px-6 py-4 text-sm">
                            <Link
                                :href="`/repos/${repositoryId}/runs/${run.id}`"
                                class="font-medium text-brand-400 hover:text-brand-300"
                            >
                                {{ runLabel(run) }}
                            </Link>
                            <CopyableCode v-if="run.head_sha" :text="run.head_sha" class="ml-2" />
                        </td>
                        <td class="whitespace-nowrap px-6 py-4 text-sm capitalize text-zinc-400">
                            {{ run.type }}
                        </td>
                        <td class="whitespace-nowrap px-6 py-4">
                            <span :class="['inline-flex rounded px-2 py-0.5 text-xs font-medium', statusBadge(run.status)]">
                                {{ run.status }}
                            </span>
                        </td>
                        <td class="whitespace-nowrap px-6 py-4 text-right text-sm text-zinc-400">
                            {{ formatDuration(run.duration_seconds) }}
                        </td>
                        <td class="whitespace-nowrap px-6 py-4 text-right text-sm text-zinc-400" :title="formatFullDate(run.created_at)">
                            {{ timeAgo(run.created_at) }}
                        </td>
                    </tr>
                    <tr v-if="!runs?.length">
                        <td colspan="5" class="px-6 py-8 text-center text-sm text-zinc-400">
                            <svg class="mx-auto h-8 w-8 text-zinc-500" fill="none" viewBox="0 0 24 24" stroke="currentColor" stroke-width="1" aria-hidden="true">
                                <path stroke-linecap="round" stroke-linejoin="round" d="M12 8v4l3 3m6-3a9 9 0 11-18 0 9 9 0 0118 0z" />
                            </svg>
                            <p class="mt-2">Review runs will appear here once you open a pull request.</p>
                        </td>
                    </tr>
                </tbody>
            </table>
        </div>
    </div>
</template>
