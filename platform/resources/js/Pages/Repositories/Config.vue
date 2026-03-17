<script setup>
import { useForm, Link, Head, router } from '@inertiajs/vue3'
import AuthenticatedLayout from '@/Layouts/AuthenticatedLayout.vue'
import { useToast } from '@/composables/useToast'

const props = defineProps({
    repository: Object,
    organization: Object,
    effectiveConfig: Object,
})

const { success } = useToast()

const form = useForm({
    review_config: {
        complexity: {
            enabled: props.repository.review_config?.complexity?.enabled ?? true,
            threshold: props.repository.review_config?.complexity?.threshold ?? 15,
        },
        architectural: {
            enabled: props.repository.review_config?.architectural?.enabled ?? 'auto',
        },
        summary: {
            enabled: props.repository.review_config?.summary?.enabled ?? true,
        },
    },
})

function submit() {
    form.put(`/repos/${props.repository.id}/config`, {
        preserveScroll: true,
        onSuccess: () => success('Configuration saved successfully.'),
    })
}

function resetToDefaults() {
    if (!window.confirm('Reset all settings to plan defaults?')) return
    router.delete(`/repos/${props.repository.id}/config`, {
        preserveScroll: true,
        onSuccess: () => success('Configuration reset to defaults.'),
    })
}

function configSource(field) {
    const overrides = props.repository.review_config || {}
    const parts = field.split('.')
    let current = overrides
    for (const part of parts) {
        if (current && typeof current === 'object' && part in current) {
            current = current[part]
        } else {
            return 'plan default'
        }
    }
    return 'repo override'
}
</script>

<template>
    <Head :title="`Configuration — ${repository.full_name}`" />

    <AuthenticatedLayout>
        <div class="mx-auto max-w-3xl">
            <h1 class="text-2xl font-medium text-zinc-100">Review Configuration</h1>

            <div v-if="Object.keys(form.errors).length" class="mt-4 rounded-lg border border-red-500/20 bg-red-900/30 p-4">
                <p v-for="(error, key) in form.errors" :key="key" class="text-sm text-red-400">{{ error }}</p>
            </div>

            <form class="mt-8 space-y-8" @submit.prevent="submit">
                <div class="rounded-lg border border-zinc-800 bg-zinc-900 p-5">
                    <h2 class="text-lg font-medium text-zinc-100">Complexity Review</h2>
                    <p class="mt-1 text-sm text-zinc-400">AST-powered complexity analysis. Always free.</p>

                    <div class="mt-4 space-y-4">
                        <div class="flex items-center justify-between">
                            <div>
                                <label for="complexity-enabled" class="font-medium text-zinc-200">Enabled</label>
                                <span class="ml-2 rounded bg-zinc-800 px-2 py-0.5 text-xs text-zinc-400">
                                    {{ configSource('complexity.enabled') }}
                                </span>
                            </div>
                            <button
                                id="complexity-enabled"
                                type="button"
                                role="switch"
                                aria-label="Enable complexity review"
                                :aria-checked="form.review_config.complexity.enabled"
                                class="relative inline-flex h-6 w-11 shrink-0 cursor-pointer rounded-full border-2 border-transparent transition-colors"
                                :class="form.review_config.complexity.enabled ? 'bg-brand-500' : 'bg-zinc-700'"
                                @click="form.review_config.complexity.enabled = !form.review_config.complexity.enabled"
                            >
                                <span
                                    class="pointer-events-none inline-block h-5 w-5 rounded-full bg-white shadow transition-transform"
                                    :class="form.review_config.complexity.enabled ? 'translate-x-5' : 'translate-x-0'"
                                />
                            </button>
                        </div>

                        <div>
                            <label for="threshold" class="block text-sm font-medium text-zinc-200">
                                Complexity Threshold
                                <span class="ml-2 rounded bg-zinc-800 px-2 py-0.5 text-xs text-zinc-400">
                                    {{ configSource('complexity.threshold') }}
                                </span>
                            </label>
                            <input
                                id="threshold"
                                v-model.number="form.review_config.complexity.threshold"
                                type="number"
                                min="1"
                                max="100"
                                class="mt-1.5 block w-24 rounded-md border border-zinc-700 bg-zinc-900 px-3 py-2 text-sm text-zinc-200"
                            />
                            <p v-if="form.errors['review_config.complexity.threshold']" class="mt-1 text-sm text-red-400">
                                {{ form.errors['review_config.complexity.threshold'] }}
                            </p>
                        </div>
                    </div>
                </div>

                <div class="rounded-lg border border-zinc-800 bg-zinc-900 p-5">
                    <h2 class="text-lg font-medium text-zinc-100">Architectural Review</h2>
                    <p class="mt-1 text-sm text-zinc-400">LLM-powered architecture analysis. Pro+ plans.</p>

                    <div class="mt-4">
                        <label for="architectural-mode" class="block text-sm font-medium text-zinc-200">
                            Mode
                            <span class="ml-2 rounded bg-zinc-800 px-2 py-0.5 text-xs text-zinc-400">
                                {{ configSource('architectural.enabled') }}
                            </span>
                        </label>
                        <select
                            id="architectural-mode"
                            v-model="form.review_config.architectural.enabled"
                            class="mt-1.5 block w-48 rounded-md border border-zinc-700 bg-zinc-900 px-3 py-2 text-sm text-zinc-200"
                        >
                            <option value="auto">Auto (structural changes only)</option>
                            <option value="always">Always</option>
                            <option value="disabled">Disabled</option>
                        </select>
                    </div>
                </div>

                <div class="rounded-lg border border-zinc-800 bg-zinc-900 p-5">
                    <h2 class="text-lg font-medium text-zinc-100">PR Summary</h2>
                    <p class="mt-1 text-sm text-zinc-400">Post a risk-assessed summary to the PR description.</p>

                    <div class="mt-4 flex items-center justify-between">
                        <div>
                            <label for="summary-enabled" class="font-medium text-zinc-200">Enabled</label>
                            <span class="ml-2 rounded bg-zinc-800 px-2 py-0.5 text-xs text-zinc-400">
                                {{ configSource('summary.enabled') }}
                            </span>
                        </div>
                        <button
                            id="summary-enabled"
                            type="button"
                            role="switch"
                            aria-label="Enable PR summary"
                            :aria-checked="form.review_config.summary.enabled"
                            class="relative inline-flex h-6 w-11 shrink-0 cursor-pointer rounded-full border-2 border-transparent transition-colors"
                            :class="form.review_config.summary.enabled ? 'bg-brand-500' : 'bg-zinc-700'"
                            @click="form.review_config.summary.enabled = !form.review_config.summary.enabled"
                        >
                            <span
                                class="pointer-events-none inline-block h-5 w-5 rounded-full bg-white shadow transition-transform"
                                :class="form.review_config.summary.enabled ? 'translate-x-5' : 'translate-x-0'"
                            />
                        </button>
                    </div>
                </div>

                <div class="rounded-lg border border-zinc-800 bg-zinc-950 p-5">
                    <h2 class="text-lg font-medium text-zinc-100">Effective Configuration</h2>
                    <p class="mt-1 text-sm text-zinc-400">
                        This is the merged configuration that will be used by the review engine.
                    </p>
                    <pre class="mt-4 overflow-auto rounded-lg border border-zinc-800 bg-zinc-950 p-4 font-mono text-[13px] text-zinc-300">{{ JSON.stringify(effectiveConfig, null, 2) }}</pre>
                </div>

                <div class="flex items-center justify-between gap-3">
                    <button
                        type="button"
                        class="text-sm font-medium text-zinc-400 transition-colors hover:text-zinc-200"
                        @click="resetToDefaults"
                    >
                        Reset to Defaults
                    </button>
                    <button
                        type="submit"
                        :disabled="form.processing"
                        class="rounded-md bg-brand-500 px-4 py-2 text-sm font-medium text-white transition-colors hover:bg-brand-600 disabled:opacity-50"
                    >
                        {{ form.processing ? 'Saving...' : 'Save Configuration' }}
                    </button>
                </div>
            </form>
        </div>
    </AuthenticatedLayout>
</template>
