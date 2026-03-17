<script setup>
import { computed, ref } from 'vue'

const props = defineProps({
    functions: { type: Array, default: () => [] },
})

const emit = defineEmits(['select'])

const hoveredFn = ref(null)
const tooltipPos = ref({ x: 0, y: 0 })

const MAP_WIDTH = 1000
const MAP_HEIGHT = 600
const GROUP_PADDING = 24
const MIN_RADIUS = 14
const MAX_RADIUS = 80

function extractModule(filepath) {
    const parts = filepath.replace(/^\//, '').split('/')
    // Skip "packages" prefix if present, then take two levels
    const start = parts[0] === 'packages' ? 1 : 0
    return parts.slice(start, start + 2).join('/')
}

function severityColor(cyclomatic) {
    if (cyclomatic >= 20) return { fill: 'rgba(127, 29, 29, 0.3)', stroke: '#f87171' } // red
    if (cyclomatic >= 10) return { fill: 'rgba(120, 53, 15, 0.3)', stroke: '#fbbf24' } // amber
    return { fill: 'rgba(30, 58, 138, 0.3)', stroke: '#60a5fa' } // blue
}

const maxCyclomatic = computed(() =>
    Math.max(...props.functions.map(f => f.cyclomatic), 1)
)

function radius(cyclomatic) {
    const scale = Math.sqrt(cyclomatic / maxCyclomatic.value)
    return MIN_RADIUS + scale * (MAX_RADIUS - MIN_RADIUS)
}

// Simple circle-packing: place circles one at a time, spiraling outward from center
function packCircles(items, cx, cy) {
    const placed = []
    for (const item of items) {
        const r = radius(item.cyclomatic)
        if (placed.length === 0) {
            placed.push({ ...item, x: cx, y: cy, r })
            continue
        }
        // Spiral outward to find a non-overlapping position
        let bestX = cx, bestY = cy
        let found = false
        for (let dist = r; dist < 300 && !found; dist += 2) {
            for (let angle = 0; angle < Math.PI * 2; angle += 0.2) {
                const tx = cx + Math.cos(angle) * dist
                const ty = cy + Math.sin(angle) * dist
                const overlaps = placed.some(p => {
                    const dx = p.x - tx
                    const dy = p.y - ty
                    return Math.sqrt(dx * dx + dy * dy) < p.r + r + 5
                })
                if (!overlaps) {
                    bestX = tx
                    bestY = ty
                    found = true
                    break
                }
            }
        }
        placed.push({ ...item, x: bestX, y: bestY, r })
    }
    return placed
}

// Compute bounding box of placed circles
function boundingBox(circles) {
    if (!circles.length) return { x: 0, y: 0, w: 0, h: 0 }
    let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity
    for (const c of circles) {
        minX = Math.min(minX, c.x - c.r)
        minY = Math.min(minY, c.y - c.r)
        maxX = Math.max(maxX, c.x + c.r)
        maxY = Math.max(maxY, c.y + c.r)
    }
    return { x: minX, y: minY, w: maxX - minX, h: maxY - minY }
}

const clusters = computed(() => {
    // Group functions by module
    const groups = {}
    for (const fn of props.functions) {
        const mod = extractModule(fn.filepath)
        if (!groups[mod]) groups[mod] = []
        groups[mod].push(fn)
    }

    // Sort groups by total complexity (biggest first)
    const sortedModules = Object.keys(groups).sort((a, b) => {
        const sumA = groups[a].reduce((s, f) => s + f.cyclomatic, 0)
        const sumB = groups[b].reduce((s, f) => s + f.cyclomatic, 0)
        return sumB - sumA
    })

    // Pack each group at origin, then we'll position them
    const packedGroups = sortedModules.map(mod => {
        const items = groups[mod].sort((a, b) => b.cyclomatic - a.cyclomatic)
        const circles = packCircles(items, 0, 0)
        const bbox = boundingBox(circles)
        return { module: mod, circles, bbox }
    })

    // Layout groups in a row-based flow layout
    const result = []
    let rowX = GROUP_PADDING
    let rowY = GROUP_PADDING + 20 // space for labels
    let rowHeight = 0

    for (const group of packedGroups) {
        const groupW = group.bbox.w + GROUP_PADDING * 2
        const groupH = group.bbox.h + GROUP_PADDING * 2 + 28 // 28 for label

        // Wrap to next row if needed
        if (rowX + groupW > MAP_WIDTH && rowX > GROUP_PADDING) {
            rowX = GROUP_PADDING
            rowY += rowHeight + GROUP_PADDING
            rowHeight = 0
        }

        const offsetX = rowX + GROUP_PADDING - group.bbox.x
        const offsetY = rowY + 28 + GROUP_PADDING - group.bbox.y

        const positioned = group.circles.map(c => ({
            ...c,
            x: c.x + offsetX,
            y: c.y + offsetY,
            colors: severityColor(c.cyclomatic),
        }))

        result.push({
            module: group.module,
            circles: positioned,
            labelX: rowX + groupW / 2,
            labelY: rowY + 16,
            bgX: rowX,
            bgY: rowY,
            bgW: groupW,
            bgH: groupH,
        })

        rowX += groupW + GROUP_PADDING
        rowHeight = Math.max(rowHeight, groupH)
    }

    return result
})

const viewBoxHeight = computed(() => {
    let maxY = MAP_HEIGHT
    for (const group of clusters.value) {
        maxY = Math.max(maxY, group.bgY + group.bgH + GROUP_PADDING)
    }
    return maxY
})

function onHover(fn, event) {
    hoveredFn.value = fn
    tooltipPos.value = { x: event.clientX, y: event.clientY }
}

function onLeave() {
    hoveredFn.value = null
}
</script>

<template>
    <div class="relative">
        <svg
            :viewBox="`0 0 ${MAP_WIDTH} ${viewBoxHeight}`"
            class="w-full"
            :style="{ minHeight: '400px' }"
        >
            <!-- Group backgrounds -->
            <g v-for="group in clusters" :key="group.module">
                <rect
                    :x="group.bgX"
                    :y="group.bgY"
                    :width="group.bgW"
                    :height="group.bgH"
                    rx="8"
                    fill="#18181b"
                    stroke="#27272a"
                    stroke-width="1"
                />
                <text
                    :x="group.labelX"
                    :y="group.labelY"
                    text-anchor="middle"
                    class="fill-zinc-500"
                    font-size="13"
                    font-weight="600"
                >
                    {{ group.module }}
                </text>
            </g>

            <!-- Circles -->
            <g v-for="group in clusters" :key="'c-' + group.module">
                <g
                    v-for="circle in group.circles"
                    :key="circle.id"
                    class="cursor-pointer"
                    role="button"
                    tabindex="0"
                    :aria-label="`${circle.symbol_name} — cyclomatic ${circle.cyclomatic}`"
                    @click="emit('select', circle)"
                    @keydown.enter.prevent="emit('select', circle)"
                    @keydown.space.prevent="emit('select', circle)"
                    @mouseenter="onHover(circle, $event)"
                    @mouseleave="onLeave"
                >
                    <circle
                        :cx="circle.x"
                        :cy="circle.y"
                        :r="circle.r"
                        :fill="circle.colors.fill"
                        :stroke="circle.colors.stroke"
                        stroke-width="2"
                        class="transition-opacity hover:opacity-80"
                    />
                    <text
                        v-if="circle.r >= 24"
                        :x="circle.x"
                        :y="circle.y - 5"
                        text-anchor="middle"
                        font-size="11"
                        font-weight="600"
                        class="pointer-events-none fill-zinc-300"
                    >
                        {{ circle.symbol_name.length > 14 ? circle.symbol_name.slice(0, 13) + '…' : circle.symbol_name }}
                    </text>
                    <text
                        v-if="circle.r >= 24"
                        :x="circle.x"
                        :y="circle.y + 10"
                        text-anchor="middle"
                        font-size="12"
                        font-weight="700"
                        class="pointer-events-none"
                        :class="circle.cyclomatic >= 20 ? 'fill-red-400' : circle.cyclomatic >= 10 ? 'fill-amber-400' : 'fill-blue-400'"
                    >
                        {{ circle.cyclomatic }}
                    </text>
                </g>
            </g>
        </svg>

        <!-- Tooltip -->
        <div
            v-if="hoveredFn"
            class="pointer-events-none fixed z-50 rounded-lg border border-zinc-700 bg-zinc-800 px-3 py-2 shadow-xl"
            :style="{ left: tooltipPos.x + 12 + 'px', top: tooltipPos.y - 10 + 'px' }"
        >
            <p class="font-mono text-sm font-semibold text-zinc-100">{{ hoveredFn.symbol_name }}</p>
            <p class="text-xs text-zinc-400">{{ hoveredFn.filepath }}</p>
            <div class="mt-1 flex gap-3 text-xs text-zinc-400">
                <span>Cyclomatic: <strong :class="hoveredFn.cyclomatic >= 20 ? 'text-red-400' : hoveredFn.cyclomatic >= 10 ? 'text-amber-400' : 'text-zinc-200'">{{ hoveredFn.cyclomatic }}</strong></span>
                <span>Cognitive: <strong class="text-zinc-200">{{ hoveredFn.cognitive }}</strong></span>
            </div>
        </div>

        <!-- Legend -->
        <div class="mt-3 flex items-center justify-center gap-5 text-xs text-zinc-400">
            <span class="flex items-center gap-1.5">
                <span class="inline-block h-3 w-3 rounded-full border-2 border-red-400 bg-red-900/30"></span>
                High (≥ 20)
            </span>
            <span class="flex items-center gap-1.5">
                <span class="inline-block h-3 w-3 rounded-full border-2 border-amber-400 bg-amber-900/30"></span>
                Medium (≥ 10)
            </span>
            <span class="flex items-center gap-1.5">
                <span class="inline-block h-3 w-3 rounded-full border-2 border-blue-400 bg-blue-900/30"></span>
                Low
            </span>
            <span class="text-zinc-500">Circle size = complexity</span>
        </div>
    </div>
</template>
