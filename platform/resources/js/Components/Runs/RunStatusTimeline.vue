<script setup>
import { computed } from 'vue'

const props = defineProps({
    reviewRun: Object,
})

const statusOrder = { pending: 0, running: 1, completed: 2, failed: 2 }

function currentStep() {
    return statusOrder[props.reviewRun.status] ?? 0
}

function stepState(index) {
    const current = currentStep()
    if (index < current) return 'done'
    if (index === current) {
        if (props.reviewRun.status === 'completed') return 'done'
        if (props.reviewRun.status === 'failed') return 'failed'
        return 'active'
    }
    return 'upcoming'
}

function isFailed() {
    return props.reviewRun.status === 'failed'
}

function formatTime(iso) {
    if (!iso) return null
    return new Date(iso).toLocaleTimeString(undefined, {
        hour: '2-digit',
        minute: '2-digit',
        second: '2-digit',
    })
}

const steps = computed(() => [
    { label: 'Queued', time: props.reviewRun.created_at },
    { label: 'Running', time: props.reviewRun.started_at },
    { label: isFailed() ? 'Failed' : 'Completed', time: props.reviewRun.completed_at },
])
</script>

<template>
    <div class="rounded-lg border border-zinc-800 bg-zinc-900 p-5">
        <div class="flex items-center justify-between">
            <div v-for="(step, index) in steps" :key="index" class="flex items-center" :class="index < steps.length - 1 ? 'flex-1' : ''">
                <div class="flex flex-col items-center">
                    <div
                        class="flex h-8 w-8 items-center justify-center rounded-full text-sm font-medium"
                        :class="{
                            'bg-blue-500 text-white': stepState(index) === 'active',
                            'bg-red-500 text-white': stepState(index) === 'failed',
                            'bg-green-500 text-white': stepState(index) === 'done',
                            'bg-zinc-700 text-zinc-500': stepState(index) === 'upcoming',
                        }"
                    >
                        <svg v-if="stepState(index) === 'done'" class="h-4 w-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" stroke-width="2.5">
                            <path stroke-linecap="round" stroke-linejoin="round" d="M5 13l4 4L19 7" />
                        </svg>
                        <svg v-else-if="stepState(index) === 'active' && reviewRun.status === 'running'" class="h-4 w-4 animate-spin" fill="none" viewBox="0 0 24 24">
                            <circle class="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" stroke-width="4" />
                            <path class="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4z" />
                        </svg>
                        <svg v-else-if="stepState(index) === 'failed'" class="h-4 w-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" stroke-width="2.5">
                            <path stroke-linecap="round" stroke-linejoin="round" d="M6 18L18 6M6 6l12 12" />
                        </svg>
                        <span v-else>{{ index + 1 }}</span>
                    </div>
                    <p class="mt-2 text-xs font-medium" :class="{
                        'text-zinc-200': stepState(index) !== 'upcoming',
                        'text-zinc-400': stepState(index) === 'upcoming',
                    }">
                        {{ step.label }}
                    </p>
                    <p v-if="step.time && stepState(index) !== 'upcoming'" class="text-xs text-zinc-400">
                        {{ formatTime(step.time) }}
                    </p>
                </div>
                <div
                    v-if="index < steps.length - 1"
                    class="mx-4 h-0.5 flex-1"
                    :class="{
                        'bg-green-500': stepState(index) === 'done',
                        'bg-blue-500': stepState(index) === 'active',
                        'bg-zinc-700': stepState(index) === 'upcoming' || stepState(index + 1) === 'upcoming',
                    }"
                />
            </div>
        </div>
    </div>
</template>
