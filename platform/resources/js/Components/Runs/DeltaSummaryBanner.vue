<script setup>
defineProps({
    summary: { type: Object, required: true },
})

function formatDelta(value) {
    if (value > 0) return `+${value}`
    return String(value)
}
</script>

<template>
    <div class="rounded-lg border border-zinc-800 bg-zinc-900 p-5">
        <div class="flex flex-wrap items-center gap-x-6 gap-y-2">
            <div class="flex items-center gap-4 text-sm">
                <span v-if="summary.worsened > 0" class="text-red-400">
                    {{ summary.worsened }} worsened
                </span>
                <span v-if="summary.improved > 0" class="text-green-400">
                    {{ summary.improved }} improved
                </span>
                <span class="text-zinc-400">
                    {{ summary.unchanged }} unchanged
                </span>
            </div>

            <span class="hidden text-zinc-700 sm:inline" aria-hidden="true">&middot;</span>

            <div class="flex items-center gap-4 text-sm">
                <span :class="summary.net_cyclomatic > 0 ? 'text-red-400' : summary.net_cyclomatic < 0 ? 'text-green-400' : 'text-zinc-400'">
                    Net cyclomatic: {{ formatDelta(summary.net_cyclomatic) }}
                </span>
                <span :class="summary.net_cognitive > 0 ? 'text-red-400' : summary.net_cognitive < 0 ? 'text-green-400' : 'text-zinc-400'">
                    Net cognitive: {{ formatDelta(summary.net_cognitive) }}
                </span>
            </div>
        </div>
    </div>
</template>
