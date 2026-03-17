<script setup>
import { computed, ref, watch } from 'vue'
import { Deferred, Link, usePoll, Head } from '@inertiajs/vue3'
import AuthenticatedLayout from '@/Layouts/AuthenticatedLayout.vue'
import RunStatusTimeline from '@/Components/Runs/RunStatusTimeline.vue'
import RunLogViewer from '@/Components/Runs/RunLogViewer.vue'
import DeltaSummaryBanner from '@/Components/Runs/DeltaSummaryBanner.vue'
import ReviewCommentsList from '@/Components/Runs/ReviewCommentsList.vue'
import ComplexityChangesTable from '@/Components/Runs/ComplexityChangesTable.vue'
import StatCard from '@/Components/StatCard.vue'
import CopyableCode from '@/Components/CopyableCode.vue'
import FunctionSourceOverlay from '@/Components/Overlays/FunctionSourceOverlay.vue'
import SkeletonTable from '@/Components/Skeletons/SkeletonTable.vue'
import SkeletonStatGrid from '@/Components/Skeletons/SkeletonStatGrid.vue'
import SkeletonDeltaBanner from '@/Components/Skeletons/SkeletonDeltaBanner.vue'

const props = defineProps({
    repository: Object,
    organization: Object,
    reviewRun: Object,
    reviewComments: Array,
    complexitySnapshots: Array,
    deltaSummary: Object,
})

const isTerminal = computed(() =>
    ['completed', 'failed'].includes(props.reviewRun.status)
)

const { stop } = usePoll(3000, {}, { autoStart: !isTerminal.value })

watch(isTerminal, (val) => {
    if (val) stop()
})

const selectedFunction = ref(null)

function shortSha(sha) {
    return sha ? sha.substring(0, 7) : '---'
}

function prUrl() {
    return `https://github.com/${props.repository.full_name}/pull/${props.reviewRun.pr_number}`
}

function summaryCommentUrl() {
    return `https://github.com/${props.repository.full_name}/pull/${props.reviewRun.pr_number}#issuecomment-${props.reviewRun.summary_comment_id}`
}

function formatCost(value) {
    return `$${Number(value).toFixed(2)}`
}

function formatDuration(seconds) {
    if (seconds < 60) return `${seconds}s`
    const mins = Math.floor(seconds / 60)
    const secs = seconds % 60
    return secs > 0 ? `${mins}m ${secs}s` : `${mins}m`
}

function formatComplexity(value) {
    if (value === null || value === undefined) return '-'
    return Number(value).toFixed(1)
}

const commentsPostedCount = computed(() => {
    if (!props.reviewComments) return 0
    return props.reviewComments.filter(c => c.status === 'posted').length
})
</script>

<template>
    <Head :title="`Run #${reviewRun.id} — ${repository.full_name}`" />

    <AuthenticatedLayout>
        <div>
            <!-- A. Header -->
            <div class="flex items-center justify-between">
                <div>
                    <h1 class="text-2xl font-medium text-zinc-100">
                        <template v-if="reviewRun.pr_number">
                            PR #{{ reviewRun.pr_number }}
                            <template v-if="reviewRun.pr_title">
                                <span class="mx-1 text-zinc-600">&mdash;</span>
                                <span class="text-zinc-300">{{ reviewRun.pr_title }}</span>
                            </template>
                        </template>
                        <template v-else>
                            Baseline Analysis
                        </template>
                    </h1>
                    <div class="mt-1 space-y-0.5">
                        <p class="text-sm text-zinc-400">
                            <template v-if="reviewRun.head_ref">
                                <span class="font-mono text-zinc-300">{{ reviewRun.head_ref }}</span>
                                <CopyableCode :text="reviewRun.head_sha" :display="shortSha(reviewRun.head_sha)" class="ml-1" />
                            </template>
                            <template v-else>
                                <CopyableCode :text="reviewRun.head_sha" :display="shortSha(reviewRun.head_sha)" />
                            </template>
                            <template v-if="reviewRun.base_sha">
                                <span class="mx-1">&larr;</span>
                                <template v-if="reviewRun.base_ref">
                                    <span class="font-mono text-zinc-300">{{ reviewRun.base_ref }}</span>
                                    <CopyableCode :text="reviewRun.base_sha" :display="shortSha(reviewRun.base_sha)" class="ml-1" />
                                </template>
                                <template v-else>
                                    <CopyableCode :text="reviewRun.base_sha" :display="shortSha(reviewRun.base_sha)" />
                                </template>
                            </template>
                        </p>
                        <p v-if="reviewRun.duration_seconds && isTerminal" class="text-xs text-zinc-500">
                            Completed in {{ formatDuration(reviewRun.duration_seconds) }}
                        </p>
                    </div>
                </div>
                <div class="flex items-center gap-2">
                    <a
                        v-if="reviewRun.summary_comment_id && reviewRun.pr_number"
                        :href="summaryCommentUrl()"
                        target="_blank"
                        rel="noopener"
                        class="rounded-md border border-zinc-700 px-4 py-2 text-sm font-medium text-zinc-300 transition-colors hover:bg-zinc-800"
                    >
                        View Summary on GitHub
                    </a>
                    <a
                        v-if="reviewRun.pr_number"
                        :href="prUrl()"
                        target="_blank"
                        rel="noopener"
                        class="rounded-md border border-zinc-700 px-4 py-2 text-sm font-medium text-zinc-300 transition-colors hover:bg-zinc-800"
                    >
                        View PR on GitHub
                    </a>
                </div>
            </div>

            <!-- B. Status Timeline -->
            <RunStatusTimeline :review-run="reviewRun" class="mt-6" />

            <!-- C. Log Viewer -->
            <RunLogViewer
                :repository-id="repository.id"
                :review-run-id="reviewRun.id"
                :status="reviewRun.status"
                class="mt-6"
            />

            <template v-if="reviewRun.status === 'completed'">
                <!-- D. Stats Grid -->
                <div class="mt-8">
                    <h2 class="text-lg font-medium text-zinc-100">Results</h2>
                    <div class="mt-3 grid grid-cols-2 gap-4 sm:grid-cols-3 lg:grid-cols-5">
                        <StatCard label="Files Analyzed" :value="reviewRun.files_analyzed" />
                        <StatCard label="Comments Posted" :value="commentsPostedCount" />
                        <StatCard label="Avg Complexity" :value="formatComplexity(reviewRun.avg_complexity)" />
                        <StatCard label="Max Complexity" :value="formatComplexity(reviewRun.max_complexity)" />
                        <StatCard label="Cost" :value="formatCost(reviewRun.cost)" />
                    </div>
                </div>

                <!-- E. Delta Summary Banner -->
                <Deferred :data="['complexitySnapshots', 'deltaSummary']">
                    <template #fallback>
                        <SkeletonDeltaBanner class="mt-6" />
                    </template>

                    <div class="deferred-enter">
                        <DeltaSummaryBanner
                            v-if="deltaSummary && (deltaSummary.worsened > 0 || deltaSummary.improved > 0)"
                            :summary="deltaSummary"
                            class="mt-6"
                        />
                    </div>
                </Deferred>

                <!-- F. Review Comments -->
                <Deferred :data="['reviewComments']">
                    <template #fallback>
                        <div class="mt-8">
                            <div class="skeleton-shimmer mb-3 h-5 w-40 rounded"></div>
                            <SkeletonTable />
                        </div>
                    </template>

                    <div class="deferred-enter mt-8">
                        <template v-if="reviewComments?.length">
                            <h2 class="text-lg font-medium text-zinc-100">
                                Review Comments
                                <span class="text-sm font-normal text-zinc-400">({{ reviewComments.length }})</span>
                            </h2>
                            <div class="mt-3">
                                <ReviewCommentsList
                                    :comments="reviewComments"
                                    :repository-full-name="repository.full_name"
                                    :pr-number="reviewRun.pr_number"
                                />
                            </div>
                        </template>

                        <div v-else class="rounded-lg border border-zinc-800 bg-zinc-900 p-12 text-center">
                            <svg class="mx-auto h-10 w-10 text-zinc-500" fill="none" viewBox="0 0 24 24" stroke="currentColor" stroke-width="1" aria-hidden="true">
                                <path stroke-linecap="round" stroke-linejoin="round" d="M9 12l2 2 4-4m6 2a9 9 0 11-18 0 9 9 0 0118 0z" />
                            </svg>
                            <p class="mt-3 text-sm text-zinc-400">No issues found — your code looks good!</p>
                        </div>
                    </div>
                </Deferred>

                <!-- G. Complexity Changes Table -->
                <Deferred :data="['complexitySnapshots', 'deltaSummary']">
                    <template #fallback>
                        <div class="mt-8">
                            <div class="skeleton-shimmer mb-3 h-5 w-48 rounded"></div>
                            <SkeletonTable />
                        </div>
                    </template>

                    <div v-if="complexitySnapshots?.length" class="deferred-enter mt-8">
                        <h2 class="text-lg font-medium text-zinc-100">
                            Complexity Changes
                            <span class="text-sm font-normal text-zinc-400">({{ complexitySnapshots.length }} functions)</span>
                        </h2>
                        <div class="mt-3">
                            <ComplexityChangesTable
                                :snapshots="complexitySnapshots"
                                :is-baseline="reviewRun.type === 'baseline'"
                                @select="selectedFunction = $event"
                            />
                        </div>
                    </div>
                </Deferred>
            </template>

            <div v-else-if="reviewRun.status === 'failed'" class="mt-8 rounded-lg border border-red-500/20 bg-red-900/30 p-5">
                <p class="font-medium text-red-400">This review run failed.</p>
                <p class="mt-1 text-sm text-zinc-400">Check the logs above for details on what went wrong.</p>
            </div>

            <!-- Function Source Overlay -->
            <FunctionSourceOverlay
                v-if="selectedFunction"
                :repository-id="repository.id"
                :function-data="selectedFunction"
                @close="selectedFunction = null"
            />
        </div>
    </AuthenticatedLayout>
</template>
