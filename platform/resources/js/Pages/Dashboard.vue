<script setup>
import { Deferred, Link, router, usePoll, Head } from '@inertiajs/vue3'
import { computed, watch } from 'vue'
import AuthenticatedLayout from '@/Layouts/AuthenticatedLayout.vue'
import SkeletonTable from '@/Components/Skeletons/SkeletonTable.vue'
import ViewToggle from '@/Components/Dashboard/ViewToggle.vue'
import AllRunsTable from '@/Components/Dashboard/AllRunsTable.vue'
import GroupedRunsTable from '@/Components/Dashboard/GroupedRunsTable.vue'

const props = defineProps({
    view: String,
    filters: Object,
    repositories: Array,
    allRuns: Object,
    groupedRuns: Object,
})

const hasActiveRuns = computed(() => {
    if (props.view === 'by_pr' && props.groupedRuns?.data) {
        return props.groupedRuns.data.some(g => g.latest_status === 'pending' || g.latest_status === 'running')
    }
    if (props.view === 'all' && props.allRuns?.data) {
        return props.allRuns.data.some(r => r.status === 'pending' || r.status === 'running')
    }
    return false
})

const { start, stop } = usePoll(10000, { only: ['runs'] }, { autoStart: false })

watch(hasActiveRuns, (active) => {
    if (active) {
        start()
    } else {
        stop()
    }
}, { immediate: true })

function switchView(newView) {
    router.get('/dashboard', { view: newView }, { preserveState: true })
}

function applyFilters(key, value) {
    const params = { view: props.view, ...props.filters }
    if (value) {
        params[key] = value
    } else {
        delete params[key]
    }
    router.get('/dashboard', params, { preserveState: true })
}
</script>

<template>
    <Head title="Review Runs — Lien Review" />

    <AuthenticatedLayout>
        <div v-if="repositories?.length">
            <h1 class="text-2xl font-medium text-zinc-100">Review Runs</h1>

            <div class="mt-6 flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between">
                <ViewToggle :view="view" @change="switchView" />

                <div class="flex gap-3" role="group" aria-label="Filter runs">
                    <div v-if="view === 'all'">
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
                    <div v-if="repositories?.length > 1">
                        <label for="filter-repo" class="sr-only">Filter by repository</label>
                        <select
                            id="filter-repo"
                            :value="filters.repo || ''"
                            class="rounded-md border border-zinc-800 bg-zinc-900 px-3 py-1.5 text-sm text-zinc-200 focus:border-brand-500 focus:ring-1 focus:ring-brand-500/20"
                            @change="applyFilters('repo', $event.target.value)"
                        >
                            <option value="">All Repositories</option>
                            <option v-for="repo in repositories" :key="repo.id" :value="repo.id">
                                {{ repo.full_name }}
                            </option>
                        </select>
                    </div>
                </div>
            </div>

            <div class="mt-6">
                <Deferred v-if="view === 'by_pr'" :data="['groupedRuns']">
                    <template #fallback>
                        <SkeletonTable />
                    </template>
                    <GroupedRunsTable :groups="groupedRuns" :filters="filters" />
                </Deferred>

                <Deferred v-else :data="['allRuns']">
                    <template #fallback>
                        <SkeletonTable />
                    </template>
                    <AllRunsTable :runs="allRuns" :filters="filters" />
                </Deferred>
            </div>
        </div>

        <div v-else class="mt-8 rounded-lg border border-zinc-800 bg-zinc-900 p-12 text-center">
            <svg class="mx-auto h-12 w-12 text-zinc-500" fill="none" viewBox="0 0 24 24" stroke="currentColor" stroke-width="1" aria-hidden="true">
                <path stroke-linecap="round" stroke-linejoin="round" d="M19 21V5a2 2 0 00-2-2H7a2 2 0 00-2 2v16m14 0h2m-2 0h-5m-9 0H3m2 0h5M9 7h1m-1 4h1m4-4h1m-1 4h1m-5 10v-5a1 1 0 011-1h2a1 1 0 011 1v5m-4 0h4" />
            </svg>
            <h3 class="mt-4 text-sm font-medium text-zinc-200">No repositories yet</h3>
            <p class="mt-1 text-sm text-zinc-400">Connect your GitHub organization to start reviewing code with AI.</p>
            <Link
                href="/onboarding/organizations"
                class="mt-6 inline-block rounded-md bg-brand-500 px-4 py-2 text-sm font-medium text-white transition-colors hover:bg-brand-600"
            >
                Get Started
            </Link>
        </div>
    </AuthenticatedLayout>
</template>
