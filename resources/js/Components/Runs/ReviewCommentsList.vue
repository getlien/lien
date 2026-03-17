<script setup>
import { ref, computed } from 'vue'
import CopyableCode from '@/Components/CopyableCode.vue'

const props = defineProps({
    comments: { type: Array, required: true },
    repositoryFullName: { type: String, required: true },
    prNumber: { type: Number, default: null },
})

const statusFilter = ref('all')
const typeFilter = ref('all')
const expandedComments = ref(new Set())

const reviewTypes = computed(() => {
    const types = new Set(props.comments.map(c => c.review_type))
    return [...types].sort()
})

const filteredComments = computed(() => {
    return props.comments.filter(c => {
        if (statusFilter.value !== 'all' && c.status !== statusFilter.value) return false
        if (typeFilter.value !== 'all' && c.review_type !== typeFilter.value) return false
        return true
    })
})

const groupedByFile = computed(() => {
    const groups = {}
    for (const comment of filteredComments.value) {
        const key = comment.filepath || '__pr_level__'
        if (!groups[key]) groups[key] = []
        groups[key].push(comment)
    }
    return groups
})

const collapsedFiles = ref(new Set())

function toggleFile(filepath) {
    if (collapsedFiles.value.has(filepath)) {
        collapsedFiles.value.delete(filepath)
    } else {
        collapsedFiles.value.add(filepath)
    }
}

function toggleExpand(id) {
    if (expandedComments.value.has(id)) {
        expandedComments.value.delete(id)
    } else {
        expandedComments.value.add(id)
    }
}

function isLong(body) {
    return body && body.length > 240
}

function statusLabel(status) {
    return {
        posted: 'Posted',
        skipped: 'Skipped',
        suppressed: 'Suppressed',
        deduped: 'Deduped',
    }[status] || status
}

function statusColor(status) {
    return {
        posted: 'bg-green-900/30 text-green-400',
        skipped: 'bg-zinc-800 text-zinc-400',
        suppressed: 'bg-amber-900/30 text-amber-400',
        deduped: 'bg-zinc-800 text-zinc-400',
    }[status] || 'bg-zinc-800 text-zinc-400'
}

function typeColor(type) {
    return {
        complexity: 'bg-amber-900/30 text-amber-400',
        architectural: 'bg-blue-900/30 text-blue-400',
        summary: 'bg-brand-900/30 text-brand-400',
    }[type] || 'bg-zinc-800 text-zinc-400'
}

function resolutionLabel(resolution) {
    return {
        resolved: 'Resolved',
        dismissed: 'Dismissed',
    }[resolution] || null
}

function resolutionColor(resolution) {
    return {
        resolved: 'bg-green-900/30 text-green-400',
        dismissed: 'bg-zinc-800 text-zinc-400',
    }[resolution] || ''
}

function githubCommentUrl(comment) {
    if (!comment.github_comment_id || !props.prNumber) return null
    return `https://github.com/${props.repositoryFullName}/pull/${props.prNumber}#discussion_r${comment.github_comment_id}`
}

function displayPath(filepath) {
    if (filepath === '__pr_level__') return 'PR-level comments'
    return filepath
}

const statusOptions = [
    { value: 'all', label: 'All' },
    { value: 'posted', label: 'Posted' },
    { value: 'suppressed', label: 'Suppressed' },
    { value: 'skipped', label: 'Skipped' },
]
</script>

<template>
    <div>
        <!-- Filter bar -->
        <div class="flex flex-wrap items-center gap-3">
            <div class="flex gap-1">
                <button
                    v-for="opt in statusOptions"
                    :key="opt.value"
                    @click="statusFilter = opt.value"
                    :class="[
                        'rounded px-2.5 py-1 text-xs font-medium transition-colors',
                        statusFilter === opt.value
                            ? 'bg-brand-900/30 text-brand-400'
                            : 'text-zinc-400 hover:bg-zinc-800 hover:text-zinc-300',
                    ]"
                    type="button"
                >
                    {{ opt.label }}
                </button>
            </div>

            <span class="text-zinc-700" aria-hidden="true">&middot;</span>

            <div class="flex gap-1">
                <button
                    @click="typeFilter = 'all'"
                    :class="[
                        'rounded px-2.5 py-1 text-xs font-medium transition-colors',
                        typeFilter === 'all'
                            ? 'bg-brand-900/30 text-brand-400'
                            : 'text-zinc-400 hover:bg-zinc-800 hover:text-zinc-300',
                    ]"
                    type="button"
                >
                    All types
                </button>
                <button
                    v-for="t in reviewTypes"
                    :key="t"
                    @click="typeFilter = t"
                    :class="[
                        'rounded px-2.5 py-1 text-xs font-medium transition-colors',
                        typeFilter === t
                            ? 'bg-brand-900/30 text-brand-400'
                            : 'text-zinc-400 hover:bg-zinc-800 hover:text-zinc-300',
                    ]"
                    type="button"
                >
                    {{ t }}
                </button>
            </div>

            <span class="ml-auto text-xs text-zinc-500">
                {{ filteredComments.length }} of {{ comments.length }}
            </span>
        </div>

        <!-- Grouped comments -->
        <div class="mt-3 space-y-3">
            <div
                v-for="(fileComments, filepath) in groupedByFile"
                :key="filepath"
                class="overflow-hidden rounded-lg border border-zinc-800"
            >
                <!-- File header -->
                <button
                    @click="toggleFile(filepath)"
                    class="flex w-full items-center gap-2 bg-zinc-900 px-4 py-2.5 text-left transition-colors hover:bg-zinc-800/50"
                    type="button"
                >
                    <svg
                        class="h-4 w-4 shrink-0 text-zinc-500 transition-transform"
                        :class="{ '-rotate-90': collapsedFiles.has(filepath) }"
                        fill="none" viewBox="0 0 24 24" stroke="currentColor" stroke-width="1.5"
                        aria-hidden="true"
                    >
                        <path stroke-linecap="round" stroke-linejoin="round" d="M19.5 8.25l-7.5 7.5-7.5-7.5" />
                    </svg>
                    <span class="truncate font-mono text-xs text-zinc-300">{{ displayPath(filepath) }}</span>
                    <span class="ml-auto shrink-0 rounded bg-zinc-800 px-1.5 py-0.5 text-xs text-zinc-400">
                        {{ fileComments.length }}
                    </span>
                </button>

                <!-- Comments in file -->
                <div v-show="!collapsedFiles.has(filepath)" class="divide-y divide-zinc-800">
                    <div v-for="comment in fileComments" :key="comment.id" class="px-4 py-3">
                        <div class="flex items-start gap-3">
                            <!-- Line + type -->
                            <div class="flex shrink-0 items-center gap-2">
                                <span v-if="comment.line" class="font-mono text-xs text-zinc-500">
                                    L{{ comment.line }}
                                </span>
                                <span :class="['inline-flex rounded px-2 py-0.5 text-xs font-medium', typeColor(comment.review_type)]">
                                    {{ comment.review_type }}
                                </span>
                            </div>

                            <!-- Status + resolution + github link -->
                            <div class="ml-auto flex shrink-0 items-center gap-2">
                                <span v-if="comment.resolution" :class="['inline-flex rounded px-2 py-0.5 text-xs font-medium', resolutionColor(comment.resolution)]">
                                    {{ resolutionLabel(comment.resolution) }}
                                </span>
                                <span :class="['inline-flex rounded px-2 py-0.5 text-xs font-medium', statusColor(comment.status)]">
                                    {{ statusLabel(comment.status) }}
                                </span>
                                <a
                                    v-if="githubCommentUrl(comment)"
                                    :href="githubCommentUrl(comment)"
                                    target="_blank"
                                    rel="noopener"
                                    class="text-zinc-500 transition-colors hover:text-zinc-300"
                                    aria-label="View on GitHub"
                                >
                                    <svg class="h-4 w-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" stroke-width="1.5">
                                        <path stroke-linecap="round" stroke-linejoin="round" d="M13.5 6H5.25A2.25 2.25 0 003 8.25v10.5A2.25 2.25 0 005.25 21h10.5A2.25 2.25 0 0018 18.75V10.5m-10.5 6L21 3m0 0h-5.25M21 3v5.25" />
                                    </svg>
                                </a>
                            </div>
                        </div>

                        <!-- Symbol name -->
                        <p v-if="comment.symbol_name" class="mt-1 font-mono text-xs text-zinc-500">
                            {{ comment.symbol_name }}
                        </p>

                        <!-- Body -->
                        <div class="mt-2">
                            <p
                                class="text-sm text-zinc-200"
                                :class="{ 'line-clamp-3': isLong(comment.body) && !expandedComments.has(comment.id) }"
                            >
                                {{ comment.body }}
                            </p>
                            <button
                                v-if="isLong(comment.body)"
                                @click="toggleExpand(comment.id)"
                                class="mt-1 text-xs text-brand-400 transition-colors hover:text-brand-300"
                                type="button"
                            >
                                {{ expandedComments.has(comment.id) ? 'Show less' : 'Show more' }}
                            </button>
                        </div>
                    </div>
                </div>
            </div>
        </div>

        <!-- Empty filtered state -->
        <div v-if="filteredComments.length === 0 && comments.length > 0" class="mt-3 rounded-lg border border-zinc-800 bg-zinc-900 p-8 text-center">
            <p class="text-sm text-zinc-400">No comments match the current filters.</p>
        </div>
    </div>
</template>
