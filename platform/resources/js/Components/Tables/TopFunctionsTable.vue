<script setup>
import { ref } from 'vue'
import ComplexityClusterMap from '@/Components/Charts/ComplexityClusterMap.vue'

defineProps({
    functions: { type: Array, default: () => [] },
    clusterMapData: { type: Array, default: () => [] },
})

const emit = defineEmits(['select'])

const viewMode = ref('table')

function trendIcon(trend) {
    switch (trend) {
        case 'up': return { symbol: '\u2191', color: 'text-red-400', label: 'Increasing' }
        case 'down': return { symbol: '\u2193', color: 'text-green-400', label: 'Decreasing' }
        case 'stable': return { symbol: '\u2192', color: 'text-zinc-500', label: 'Stable' }
        case 'new': return { symbol: 'NEW', color: 'text-blue-400', label: 'New' }
        default: return { symbol: '-', color: 'text-zinc-500', label: 'Unknown' }
    }
}
</script>

<template>
    <div class="rounded-lg border border-zinc-800 bg-zinc-900">
        <div class="flex items-center justify-between p-5 pb-0">
            <h3 class="text-lg font-medium text-zinc-100">Top Complex Functions</h3>
            <div role="tablist" class="flex rounded-md border border-zinc-700 bg-zinc-800 p-0.5">
                <button
                    type="button"
                    role="tab"
                    :aria-selected="viewMode === 'table'"
                    :class="[
                        'rounded-md px-3 py-1 text-xs font-medium transition-colors',
                        viewMode === 'table'
                            ? 'bg-zinc-700 text-zinc-100'
                            : 'text-zinc-500 hover:text-zinc-300',
                    ]"
                    @click="viewMode = 'table'"
                >
                    Table
                </button>
                <button
                    type="button"
                    role="tab"
                    :aria-selected="viewMode === 'map'"
                    :class="[
                        'rounded-md px-3 py-1 text-xs font-medium transition-colors',
                        viewMode === 'map'
                            ? 'bg-zinc-700 text-zinc-100'
                            : 'text-zinc-500 hover:text-zinc-300',
                    ]"
                    @click="viewMode = 'map'"
                >
                    Map
                </button>
            </div>
        </div>

        <!-- Table view -->
        <div v-if="viewMode === 'table'" class="mt-4 overflow-x-auto">
            <table class="min-w-full divide-y divide-zinc-800">
                <thead>
                    <tr>
                        <th scope="col" class="px-6 py-3 text-left text-xs font-medium text-zinc-400">Function</th>
                        <th scope="col" class="px-6 py-3 text-left text-xs font-medium text-zinc-400">File</th>
                        <th scope="col" class="px-6 py-3 text-right text-xs font-medium text-zinc-400">Cyclomatic</th>
                        <th scope="col" class="px-6 py-3 text-right text-xs font-medium text-zinc-400">Cognitive</th>
                        <th scope="col" class="px-6 py-3 text-center text-xs font-medium text-zinc-400">Trend</th>
                    </tr>
                </thead>
                <tbody class="divide-y divide-zinc-800">
                    <tr v-for="fn in functions" :key="`${fn.filepath}:${fn.symbol_name}`"
                        class="cursor-pointer transition-colors hover:bg-zinc-800/50"
                        role="button"
                        tabindex="0"
                        @click="emit('select', fn)"
                        @keydown.enter.space.prevent="emit('select', fn)"
                    >
                        <td class="whitespace-nowrap px-6 py-4 font-mono text-sm text-zinc-200">
                            {{ fn.symbol_name }}
                        </td>
                        <td class="px-6 py-4 text-sm text-zinc-400">
                            {{ fn.filepath }}
                        </td>
                        <td class="whitespace-nowrap px-6 py-4 text-right text-sm font-medium"
                            :class="fn.cyclomatic >= 20 ? 'text-red-400' : fn.cyclomatic >= 10 ? 'text-amber-400' : 'text-zinc-200'"
                        >
                            {{ fn.cyclomatic }}
                        </td>
                        <td class="whitespace-nowrap px-6 py-4 text-right text-sm text-zinc-200">
                            {{ fn.cognitive }}
                        </td>
                        <td class="whitespace-nowrap px-6 py-4 text-center">
                            <span
                                class="text-sm font-bold"
                                :class="trendIcon(fn.trend).color"
                                :title="trendIcon(fn.trend).label"
                            >
                                {{ trendIcon(fn.trend).symbol }}
                            </span>
                        </td>
                    </tr>
                    <tr v-if="!functions?.length">
                        <td colspan="5" class="px-6 py-8 text-center text-sm text-zinc-400">
                            No complexity data available yet.
                        </td>
                    </tr>
                </tbody>
            </table>
        </div>

        <!-- Map view -->
        <div v-else class="p-5 pt-4">
            <ComplexityClusterMap
                v-if="clusterMapData?.length"
                :functions="clusterMapData"
                @select="emit('select', $event)"
            />
            <p v-else class="py-8 text-center text-sm text-zinc-400">
                No complexity data available yet.
            </p>
        </div>
    </div>
</template>
