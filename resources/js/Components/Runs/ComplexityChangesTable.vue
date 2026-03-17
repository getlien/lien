<script setup>
import { ref, computed } from 'vue'

const props = defineProps({
    snapshots: { type: Array, required: true },
    isBaseline: { type: Boolean, default: false },
})

const emit = defineEmits(['select'])

const showOnlyChanges = ref(true)

const filteredSnapshots = computed(() => {
    if (props.isBaseline || !showOnlyChanges.value) return props.snapshots
    return props.snapshots.filter(s =>
        (s.delta_cyclomatic ?? 0) !== 0 || (s.delta_cognitive ?? 0) !== 0
    )
})

function severityColor(severity) {
    return {
        error: 'bg-red-900/30 text-red-400',
        warning: 'bg-amber-900/30 text-amber-400',
        info: 'bg-blue-900/30 text-blue-400',
    }[severity] || ''
}

function complexityColor(value) {
    if (value >= 20) return 'text-red-400'
    if (value >= 10) return 'text-amber-400'
    return 'text-zinc-200'
}

function deltaColor(value) {
    if (value > 0) return 'text-red-400'
    if (value < 0) return 'text-green-400'
    return 'text-zinc-500'
}

function formatDelta(value) {
    if (value === null || value === undefined) return '-'
    if (value > 0) return `+${value}`
    return String(value)
}
</script>

<template>
    <div>
        <!-- Toggle -->
        <div v-if="!isBaseline" class="mb-3 flex items-center gap-2">
            <button
                @click="showOnlyChanges = true"
                :class="[
                    'rounded px-2.5 py-1 text-xs font-medium transition-colors',
                    showOnlyChanges
                        ? 'bg-brand-900/30 text-brand-400'
                        : 'text-zinc-400 hover:bg-zinc-800 hover:text-zinc-300',
                ]"
                type="button"
            >
                Show only changes
            </button>
            <button
                @click="showOnlyChanges = false"
                :class="[
                    'rounded px-2.5 py-1 text-xs font-medium transition-colors',
                    !showOnlyChanges
                        ? 'bg-brand-900/30 text-brand-400'
                        : 'text-zinc-400 hover:bg-zinc-800 hover:text-zinc-300',
                ]"
                type="button"
            >
                Show all functions
            </button>

            <span class="ml-auto text-xs text-zinc-500">
                {{ filteredSnapshots.length }} of {{ snapshots.length }}
            </span>
        </div>

        <div v-if="filteredSnapshots.length" class="overflow-hidden rounded-lg border border-zinc-800">
            <div class="overflow-x-auto">
                <table class="min-w-full divide-y divide-zinc-800" aria-label="Complexity changes">
                    <thead>
                        <tr>
                            <th scope="col" class="px-4 py-3 text-left text-xs font-medium text-zinc-400">Function</th>
                            <th scope="col" class="px-4 py-3 text-left text-xs font-medium text-zinc-400">File</th>
                            <th scope="col" class="px-4 py-3 text-right text-xs font-medium text-zinc-400">Cyclomatic</th>
                            <th v-if="!isBaseline" scope="col" class="px-4 py-3 text-right text-xs font-medium text-zinc-400">Delta</th>
                            <th scope="col" class="px-4 py-3 text-right text-xs font-medium text-zinc-400">Cognitive</th>
                            <th v-if="!isBaseline" scope="col" class="px-4 py-3 text-right text-xs font-medium text-zinc-400">Delta</th>
                            <th scope="col" class="px-4 py-3 text-left text-xs font-medium text-zinc-400">Severity</th>
                        </tr>
                    </thead>
                    <tbody class="divide-y divide-zinc-800">
                        <tr
                            v-for="snapshot in filteredSnapshots"
                            :key="snapshot.id"
                            class="cursor-pointer transition-colors hover:bg-zinc-800/50"
                            @click="emit('select', snapshot)"
                        >
                            <td class="whitespace-nowrap px-4 py-3 font-mono text-xs text-zinc-200">
                                {{ snapshot.symbol_name }}
                            </td>
                            <td class="max-w-xs truncate px-4 py-3 font-mono text-xs text-zinc-400">
                                {{ snapshot.filepath }}
                            </td>
                            <td class="whitespace-nowrap px-4 py-3 text-right text-sm" :class="complexityColor(snapshot.cyclomatic)">
                                {{ snapshot.cyclomatic }}
                            </td>
                            <td v-if="!isBaseline" class="whitespace-nowrap px-4 py-3 text-right text-sm" :class="deltaColor(snapshot.delta_cyclomatic)">
                                {{ formatDelta(snapshot.delta_cyclomatic) }}
                            </td>
                            <td class="whitespace-nowrap px-4 py-3 text-right text-sm text-zinc-200">
                                {{ snapshot.cognitive }}
                            </td>
                            <td v-if="!isBaseline" class="whitespace-nowrap px-4 py-3 text-right text-sm" :class="deltaColor(snapshot.delta_cognitive)">
                                {{ formatDelta(snapshot.delta_cognitive) }}
                            </td>
                            <td class="whitespace-nowrap px-4 py-3">
                                <span
                                    v-if="snapshot.severity && snapshot.severity !== 'none'"
                                    :class="['inline-flex rounded px-2 py-0.5 text-xs font-medium', severityColor(snapshot.severity)]"
                                >
                                    {{ snapshot.severity }}
                                </span>
                            </td>
                        </tr>
                    </tbody>
                </table>
            </div>
        </div>

        <div v-else class="rounded-lg border border-zinc-800 bg-zinc-900 p-8 text-center">
            <p class="text-sm text-zinc-400">
                <template v-if="!isBaseline && showOnlyChanges">
                    No complexity changes detected. Try "Show all functions" to see the full baseline.
                </template>
                <template v-else>
                    No complexity data available for this run.
                </template>
            </p>
        </div>
    </div>
</template>
