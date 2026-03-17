<script setup>
</script>

<template>
    <div class="rounded-lg border border-zinc-800 bg-zinc-900 p-5">
        <div class="skeleton-shimmer mb-4 h-4 w-48 rounded"></div>
        <div class="space-y-3">
            <div v-for="i in 5" :key="i" class="flex gap-4">
                <div class="skeleton-shimmer h-4 w-1/4 rounded"></div>
                <div class="skeleton-shimmer h-4 w-1/3 rounded"></div>
                <div class="skeleton-shimmer h-4 w-16 rounded"></div>
                <div class="skeleton-shimmer h-4 w-16 rounded"></div>
            </div>
        </div>
    </div>
</template>
