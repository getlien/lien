<script setup>
import { ref, computed, onMounted, onUnmounted, nextTick, watch } from 'vue'

const props = defineProps({
    repositoryId: Number,
    reviewRunId: Number,
    status: String,
})

const logs = ref([])
const lastId = ref(0)
const logContainer = ref(null)
const autoScroll = ref(true)
const isPolling = ref(false)
const expanded = ref(!['completed', 'failed'].includes(props.status))
let pollTimer = null

const isTerminal = computed(() =>
    ['completed', 'failed'].includes(props.status)
)

async function fetchLogs() {
    try {
        const url = `/repos/${props.repositoryId}/runs/${props.reviewRunId}/logs?after=${lastId.value}`
        const response = await fetch(url)

        if (!response.ok) return

        const data = await response.json()

        if (data.logs.length > 0) {
            logs.value.push(...data.logs)
            lastId.value = data.logs[data.logs.length - 1].id

            if (autoScroll.value) {
                await nextTick()
                scrollToBottom()
            }
        }

        if (['completed', 'failed'].includes(data.status)) {
            stopPolling()
        }
    } catch {
        // Silently ignore fetch errors during polling
    }
}

function scrollToBottom() {
    if (logContainer.value) {
        logContainer.value.scrollTop = logContainer.value.scrollHeight
    }
}

function handleScroll() {
    if (!logContainer.value) return
    const { scrollTop, scrollHeight, clientHeight } = logContainer.value
    autoScroll.value = (scrollHeight - scrollTop - clientHeight) < 50
}

function startPolling() {
    pollTimer = setInterval(fetchLogs, 2000)
    isPolling.value = true
}

function stopPolling() {
    if (pollTimer) {
        clearInterval(pollTimer)
        pollTimer = null
    }
    isPolling.value = false
}

onMounted(() => {
    fetchLogs()

    if (!isTerminal.value) {
        startPolling()
    }
})

onUnmounted(() => {
    stopPolling()
})

watch(() => props.status, (newStatus) => {
    if (['completed', 'failed'].includes(newStatus)) {
        fetchLogs()
        stopPolling()
        expanded.value = false
    }
})

function levelColor(level) {
    return {
        info: 'text-zinc-400',
        warning: 'text-amber-400',
        error: 'text-red-400',
    }[level] || 'text-zinc-400'
}

function formatLogTime(iso) {
    return new Date(iso).toLocaleTimeString(undefined, {
        hour: '2-digit',
        minute: '2-digit',
        second: '2-digit',
        hour12: false,
    })
}
</script>

<template>
    <div class="overflow-hidden rounded-lg border border-zinc-800 bg-zinc-950">
        <div
            class="flex items-center justify-between border-b border-zinc-800 px-4 py-2"
            :class="isTerminal ? 'cursor-pointer hover:bg-zinc-900' : ''"
            @click="isTerminal && (expanded = !expanded)"
        >
            <div class="flex items-center gap-2">
                <svg
                    v-if="isTerminal"
                    class="h-4 w-4 text-zinc-500 transition-transform duration-150"
                    :class="expanded ? 'rotate-180' : ''"
                    viewBox="0 0 20 20"
                    fill="currentColor"
                    aria-hidden="true"
                >
                    <path fill-rule="evenodd" d="M5.23 7.21a.75.75 0 011.06.02L10 11.168l3.71-3.938a.75.75 0 111.08 1.04l-4.25 4.5a.75.75 0 01-1.08 0l-4.25-4.5a.75.75 0 01.02-1.06z" clip-rule="evenodd" />
                </svg>
                <h3 class="text-sm font-medium text-zinc-300">Logs</h3>
            </div>
            <div class="flex items-center gap-3">
                <span v-if="!isTerminal && isPolling" class="flex items-center gap-1.5 text-xs text-green-400">
                    <span class="h-1.5 w-1.5 animate-pulse rounded-full bg-green-400" />
                    Live
                </span>
                <span v-if="logs.length" class="text-xs text-zinc-400">
                    {{ logs.length }} entries
                </span>
            </div>
        </div>
        <div v-if="!expanded && isTerminal" class="px-4 py-2 text-xs text-zinc-400">
            {{ logs.length }} log entries — click to expand
        </div>
        <div
            v-show="expanded"
            ref="logContainer"
            class="h-96 overflow-y-auto p-4 font-mono text-sm leading-relaxed"
            @scroll="handleScroll"
        >
            <div v-if="logs.length === 0 && !isTerminal" class="flex h-full items-center justify-center text-zinc-400">
                Waiting for logs...
            </div>
            <div v-else-if="logs.length === 0 && isTerminal" class="flex h-full items-center justify-center text-zinc-400">
                No logs recorded for this run.
            </div>
            <div
                v-for="log in logs"
                :key="log.id"
                class="flex gap-3 py-0.5"
            >
                <span class="shrink-0 text-zinc-500">{{ formatLogTime(log.logged_at) }}</span>
                <span :class="['w-7 shrink-0 uppercase', levelColor(log.level)]">
                    {{ log.level === 'warning' ? 'wrn' : log.level === 'error' ? 'err' : 'inf' }}
                </span>
                <span class="text-zinc-200">{{ log.message }}</span>
            </div>
        </div>
    </div>
</template>
