<script setup>
defineProps({
    view: String,
})

const emit = defineEmits(['change'])
</script>

<template>
    <div class="flex items-center gap-1 rounded-lg border border-zinc-800 bg-zinc-900 p-1" role="group" aria-label="View mode">
        <button
            type="button"
            :class="[
                'rounded-md px-3 py-1.5 text-sm transition-colors duration-150',
                view === 'by_pr' ? 'bg-brand-950 font-medium text-brand-400' : 'text-zinc-400 hover:text-zinc-200',
            ]"
            :aria-pressed="view === 'by_pr'"
            @click="emit('change', 'by_pr')"
        >
            By PR
        </button>
        <button
            type="button"
            :class="[
                'rounded-md px-3 py-1.5 text-sm transition-colors duration-150',
                view === 'all' ? 'bg-brand-950 font-medium text-brand-400' : 'text-zinc-400 hover:text-zinc-200',
            ]"
            :aria-pressed="view === 'all'"
            @click="emit('change', 'all')"
        >
            All Runs
        </button>
    </div>
</template>
