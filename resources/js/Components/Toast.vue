<script setup>
import { watch } from 'vue'
import { usePage } from '@inertiajs/vue3'
import { useToast } from '@/composables/useToast'

const { toasts, success, error, remove } = useToast()
const page = usePage()

watch(
    () => ({
        success: page.props.flash?.success,
        error: page.props.flash?.error,
    }),
    (flash) => {
        if (flash?.success) success(flash.success)
        if (flash?.error) error(flash.error)
    },
    { deep: true, immediate: true },
)
</script>

<template>
    <div class="fixed right-4 top-4 z-50" aria-live="polite">
        <TransitionGroup
            tag="div"
            class="flex flex-col gap-2"
            enter-active-class="toast-enter-active"
            enter-from-class="toast-enter-from"
            leave-active-class="toast-leave-active"
            leave-to-class="toast-leave-to"
        >
            <div
                v-for="toast in toasts"
                :key="toast.id"
                :class="[
                    'flex items-center gap-3 rounded-lg border px-4 py-3 shadow-lg',
                    toast.type === 'success'
                        ? 'border-green-500/20 bg-green-900/30 text-green-400'
                        : 'border-red-500/20 bg-red-900/30 text-red-400',
                ]"
            >
                <svg
                    v-if="toast.type === 'success'"
                    class="h-5 w-5 shrink-0 text-green-400"
                    fill="none"
                    viewBox="0 0 24 24"
                    stroke="currentColor"
                    stroke-width="2"
                    aria-hidden="true"
                >
                    <path stroke-linecap="round" stroke-linejoin="round" d="M9 12l2 2 4-4m6 2a9 9 0 11-18 0 9 9 0 0118 0z" />
                </svg>
                <svg
                    v-else
                    class="h-5 w-5 shrink-0 text-red-400"
                    fill="none"
                    viewBox="0 0 24 24"
                    stroke="currentColor"
                    stroke-width="2"
                    aria-hidden="true"
                >
                    <path stroke-linecap="round" stroke-linejoin="round" d="M12 8v4m0 4h.01M21 12a9 9 0 11-18 0 9 9 0 0118 0z" />
                </svg>
                <p class="text-sm font-medium">{{ toast.message }}</p>
                <button
                    class="ml-auto shrink-0 text-current opacity-50 hover:opacity-100"
                    aria-label="Dismiss notification"
                    @click="remove(toast.id)"
                >
                    <svg class="h-4 w-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" stroke-width="2" aria-hidden="true">
                        <path stroke-linecap="round" stroke-linejoin="round" d="M6 18L18 6M6 6l12 12" />
                    </svg>
                </button>
            </div>
        </TransitionGroup>
    </div>
</template>
