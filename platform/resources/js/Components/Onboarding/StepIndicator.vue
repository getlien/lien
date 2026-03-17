<script setup>
defineProps({
    currentStep: { type: Number, required: true },
    labels: { type: Array, default: () => ['Select Organization', 'Select Repositories'] },
})
</script>

<template>
    <nav aria-label="Onboarding progress" class="mb-8">
        <ol class="flex items-center">
            <li
                v-for="(label, index) in labels"
                :key="index"
                class="flex items-center"
                :class="index < labels.length - 1 ? 'flex-1' : ''"
                :aria-current="index + 1 === currentStep ? 'step' : undefined"
            >
                <div class="flex items-center gap-2">
                    <!-- Completed step -->
                    <div
                        v-if="index + 1 < currentStep"
                        class="flex h-7 w-7 items-center justify-center rounded-full bg-brand-500"
                    >
                        <svg class="h-3.5 w-3.5 text-white" fill="currentColor" viewBox="0 0 20 20" aria-hidden="true">
                            <path fill-rule="evenodd" d="M16.707 5.293a1 1 0 010 1.414l-8 8a1 1 0 01-1.414 0l-4-4a1 1 0 011.414-1.414L8 12.586l7.293-7.293a1 1 0 011.414 0z" clip-rule="evenodd" />
                        </svg>
                    </div>

                    <!-- Active step -->
                    <div
                        v-else-if="index + 1 === currentStep"
                        class="flex h-7 w-7 items-center justify-center rounded-full bg-brand-500 text-xs font-medium text-white"
                    >
                        {{ index + 1 }}
                    </div>

                    <!-- Future step -->
                    <div
                        v-else
                        class="flex h-7 w-7 items-center justify-center rounded-full border border-zinc-700 text-xs font-medium text-zinc-500"
                    >
                        {{ index + 1 }}
                    </div>

                    <span
                        class="hidden text-sm font-medium sm:inline"
                        :class="index + 1 < currentStep
                            ? 'text-zinc-400'
                            : index + 1 === currentStep
                                ? 'text-brand-400'
                                : 'text-zinc-500'"
                    >
                        {{ label }}
                    </span>
                </div>

                <!-- Connecting line -->
                <div
                    v-if="index < labels.length - 1"
                    class="mx-3 h-px flex-1"
                    :class="index + 1 < currentStep ? 'bg-brand-500' : 'bg-zinc-700'"
                />
            </li>
        </ol>
    </nav>
</template>
