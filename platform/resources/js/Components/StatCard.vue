<script setup>
defineProps({
    label: String,
    value: [String, Number],
})
</script>

<template>
    <div class="rounded-lg border border-zinc-800 bg-zinc-900 p-5">
        <p class="text-sm font-medium text-zinc-400">{{ label }}</p>
        <p class="mt-2 text-3xl font-medium text-zinc-100">{{ value }}</p>
    </div>
</template>
