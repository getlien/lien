<script setup>
defineProps({
    size: { type: String, default: 'md' },
    showText: { type: Boolean, default: true },
})
</script>

<template>
    <div class="flex items-center gap-2.5">
        <svg
            :class="{
                'h-6 w-6': size === 'sm',
                'h-7 w-7': size === 'md',
                'h-10 w-10': size === 'lg',
            }"
            viewBox="0 0 28 28"
            fill="none"
            aria-hidden="true"
        >
            <rect width="28" height="28" rx="7" class="fill-brand-600" />
            <path
                d="M10 7.5v13h8.5"
                stroke="white"
                stroke-width="2.5"
                stroke-linecap="round"
                stroke-linejoin="round"
            />
        </svg>
        <span v-if="showText" class="text-lg font-medium text-zinc-100">
            Lien Review
        </span>
    </div>
</template>
