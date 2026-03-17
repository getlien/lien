<script setup>
import { Link, router, Head } from '@inertiajs/vue3'
import AuthenticatedLayout from '@/Layouts/AuthenticatedLayout.vue'
import CopyableCode from '@/Components/CopyableCode.vue'
import PrGroupRow from '@/Components/Tables/PrGroupRow.vue'
import { statusBadge, formatDuration, timeAgo, formatFullDate, runLabel } from '@/utils/runs'

const props = defineProps({
    repository: Object,
    organization: Object,
    runs: Object,
    prGroups: Object,
    filters: Object,
    view: { type: String, default: 'grouped' },
})

function applyFilters(key, value) {
    const params = { ...props.filters, view: props.view }
    if (value) {
        params[key] = value
    } else {
        delete params[key]
    }
    router.get(`/repos/${props.repository.id}/runs`, params, { preserveState: true })
}

function switchView(view) {
    const params = view === 'all' ? { view: 'all' } : {}
    router.get(`/repos/${props.repository.id}/runs`, params, { preserveState: true })
}

function loadMoreGroups() {
    if (!props.prGroups?.has_more) return
    const nextPage = (props.prGroups.page ?? 1) + 1
    router.get(`/repos/${props.repository.id}/runs`, { view: 'grouped', page: nextPage }, { preserveState: true })
}
</script>

<template>
    <Head :title="`Runs — ${repository.full_name}`" />

    <AuthenticatedLayout>
        <div>
            <h1 class="text-2xl font-medium text-zinc-100">Review Runs</h1>

            <div class="mt-6 flex items-center gap-4">
                <div class="flex items-center gap-1 rounded-lg border border-zinc-800 bg-zinc-900 p-1" role="tablist" aria-label="View mode">
                    <button
                        role="tab"
                        :aria-selected="view === 'grouped'"
                        :class="[
                            'rounded-md px-3 py-1.5 text-sm transition-colors duration-150',
                            view === 'grouped'
                                ? 'bg-brand-950 font-medium text-brand-400'
                                : 'text-zinc-400 hover:text-zinc-200',
                        ]"
                        @click="switchView('grouped')"
                    >
                        By PR
                    </button>
                    <button
                        role="tab"
                        :aria-selected="view === 'all'"
                        :class="[
                            'rounded-md px-3 py-1.5 text-sm transition-colors duration-150',
                            view === 'all'
                                ? 'bg-brand-950 font-medium text-brand-400'
                                : 'text-zinc-400 hover:text-zinc-200',
                        ]"
                        @click="switchView('all')"
                    >
                        All Runs
                    </button>
                </div>

                <div v-if="view === 'all'" class="flex gap-3" role="group" aria-label="Filter review runs">
                    <div>
                        <label for="filter-type" class="sr-only">Filter by type</label>
                        <select
                            id="filter-type"
                            :value="filters.type || ''"
                            class="rounded-md border border-zinc-800 bg-zinc-900 px-3 py-1.5 text-sm text-zinc-200 focus:border-brand-500 focus:ring-1 focus:ring-brand-500/20"
                            @change="applyFilters('type', $event.target.value)"
                        >
                            <option value="">All Types</option>
                            <option value="baseline">Baseline</option>
                            <option value="pr">PR</option>
                        </select>
                    </div>
                    <div>
                        <label for="filter-status" class="sr-only">Filter by status</label>
                        <select
                            id="filter-status"
                            :value="filters.status || ''"
                            class="rounded-md border border-zinc-800 bg-zinc-900 px-3 py-1.5 text-sm text-zinc-200 focus:border-brand-500 focus:ring-1 focus:ring-brand-500/20"
                            @change="applyFilters('status', $event.target.value)"
                        >
                            <option value="">All Statuses</option>
                            <option value="pending">Pending</option>
                            <option value="running">Running</option>
                            <option value="completed">Completed</option>
                            <option value="failed">Failed</option>
                        </select>
                    </div>
                </div>
            </div>

            <!-- All Runs view -->
            <div v-if="view === 'all'" class="mt-4 overflow-hidden rounded-lg border border-zinc-800 bg-zinc-900">
                <div class="overflow-x-auto">
                    <table class="w-full divide-y divide-zinc-800" aria-label="Review runs">
                        <thead>
                            <tr>
                                <th scope="col" class="px-6 py-3 text-left text-xs font-medium text-zinc-400">Run</th>
                                <th scope="col" class="px-6 py-3 text-left text-xs font-medium text-zinc-400">Type</th>
                                <th scope="col" class="px-6 py-3 text-left text-xs font-medium text-zinc-400">Status</th>
                                <th scope="col" class="px-6 py-3 text-right text-xs font-medium text-zinc-400">Files</th>
                                <th scope="col" class="px-6 py-3 text-right text-xs font-medium text-zinc-400">Duration</th>
                                <th scope="col" class="px-6 py-3 text-right text-xs font-medium text-zinc-400">When</th>
                            </tr>
                        </thead>
                        <tbody class="divide-y divide-zinc-800">
                            <tr v-for="run in runs.data" :key="run.id" class="transition-colors hover:bg-zinc-800/50">
                                <td class="whitespace-nowrap px-6 py-4 text-sm">
                                    <Link
                                        :href="`/repos/${repository.id}/runs/${run.id}`"
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
                                    {{ run.files_analyzed ?? '—' }}
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
                                    <svg class="mx-auto h-10 w-10 text-zinc-500" fill="none" viewBox="0 0 24 24" stroke="currentColor" stroke-width="1" aria-hidden="true">
                                        <path stroke-linecap="round" stroke-linejoin="round" d="M21 21l-6-6m2-5a7 7 0 11-14 0 7 7 0 0114 0z" />
                                    </svg>
                                    <p class="mt-2">
                                        {{ (filters.type || filters.status) ? 'No runs match your filters.' : 'Open a pull request to trigger your first review.' }}
                                    </p>
                                </td>
                            </tr>
                        </tbody>
                    </table>
                </div>
            </div>

            <!-- By PR view -->
            <div v-if="view === 'grouped'" class="mt-4 overflow-hidden rounded-lg border border-zinc-800 bg-zinc-900">
                <div class="overflow-x-auto">
                    <table class="w-full divide-y divide-zinc-800" aria-label="PR groups">
                        <thead>
                            <tr>
                                <th scope="col" class="px-6 py-3 text-left text-xs font-medium text-zinc-400">Pull Request</th>
                                <th scope="col" class="px-6 py-3 text-left text-xs font-medium text-zinc-400">Runs</th>
                                <th scope="col" class="px-6 py-3 text-left text-xs font-medium text-zinc-400">Status</th>
                                <th scope="col" class="px-6 py-3 text-left text-xs font-medium text-zinc-400">Trend</th>
                                <th scope="col" class="px-6 py-3 text-right text-xs font-medium text-zinc-400">Complexity</th>
                                <th scope="col" class="px-6 py-3 text-right text-xs font-medium text-zinc-400">When</th>
                                <th scope="col" class="w-8 px-3 py-3"><span class="sr-only">Expand</span></th>
                            </tr>
                        </thead>
                        <tbody class="divide-y divide-zinc-800">
                            <PrGroupRow
                                v-for="group in prGroups?.data"
                                :key="group.pr_number"
                                :group="group"
                                :repository-id="repository.id"
                            />
                            <tr v-if="!prGroups?.data?.length">
                                <td colspan="7" class="px-6 py-8 text-center text-sm text-zinc-400">
                                    <svg class="mx-auto h-10 w-10 text-zinc-500" fill="none" viewBox="0 0 24 24" stroke="currentColor" stroke-width="1" aria-hidden="true">
                                        <path stroke-linecap="round" stroke-linejoin="round" d="M21 21l-6-6m2-5a7 7 0 11-14 0 7 7 0 0114 0z" />
                                    </svg>
                                    <p class="mt-2">No PR runs yet. Open a pull request to trigger your first review.</p>
                                </td>
                            </tr>
                        </tbody>
                    </table>
                </div>
            </div>

            <!-- Pagination: All Runs -->
            <div v-if="view === 'all' && runs?.last_page > 1" class="mt-4 flex items-center justify-between">
                <p class="text-sm text-zinc-400">
                    Showing {{ runs.from }}&ndash;{{ runs.to }} of {{ runs.total }}
                </p>
                <div class="flex gap-2">
                    <component
                        :is="link.url ? Link : 'span'"
                        v-for="link in runs.links"
                        :key="link.label"
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

            <!-- Load More: By PR -->
            <div v-if="view === 'grouped' && prGroups?.has_more" class="mt-4 flex justify-center">
                <button
                    class="rounded-md border border-zinc-700 px-4 py-2 text-sm font-medium text-zinc-300 transition-colors hover:bg-zinc-800/50"
                    @click="loadMoreGroups"
                >
                    Load more
                </button>
            </div>
        </div>
    </AuthenticatedLayout>
</template>
