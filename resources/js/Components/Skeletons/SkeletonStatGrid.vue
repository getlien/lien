<script setup>
defineProps({
    count: { type: Number, default: 3 },
})
</script>

<template>
    <div class="grid grid-cols-2 gap-4 sm:grid-cols-3 lg:grid-cols-5">
        <div v-for="i in count" :key="i" class="rounded-lg border border-zinc-800 bg-zinc-900 p-5">
            <div class="skeleton-shimmer h-3 w-24 rounded"></div>
            <div class="skeleton-shimmer mt-3 h-8 w-16 rounded"></div>
        </div>
    </div>
</template>
