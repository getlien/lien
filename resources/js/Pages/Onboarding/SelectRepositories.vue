<script setup>
import { ref, computed } from 'vue'
import { Link, useForm } from '@inertiajs/vue3'
import AuthenticatedLayout from '@/Layouts/AuthenticatedLayout.vue'
import StepIndicator from '@/Components/Onboarding/StepIndicator.vue'

const props = defineProps({
    organization: Object,
    repositories: Array,
})

const selectedIds = ref([])

const isSelected = (id) => selectedIds.value.includes(id)

function toggle(repo) {
    const idx = selectedIds.value.indexOf(repo.id)
    if (idx >= 0) {
        selectedIds.value.splice(idx, 1)
    } else {
        selectedIds.value.push(repo.id)
    }
}

function toggleAll() {
    if (selectedIds.value.length === props.repositories.length) {
        selectedIds.value = []
    } else {
        selectedIds.value = props.repositories.map(r => r.id)
    }
}

const allSelected = computed(() => selectedIds.value.length === props.repositories?.length)

const form = useForm({
    repositories: [],
})

function submit() {
    form.repositories = props.repositories
        .filter(r => isSelected(r.id))
        .map(r => ({
            id: r.id,
            full_name: r.full_name,
            default_branch: r.default_branch,
            private: r.private,
        }))

    form.post('/onboarding/repositories')
}
</script>

<template>
    <AuthenticatedLayout>
        <div class="mx-auto max-w-2xl">
            <StepIndicator :current-step="2" />

            <div class="flex items-center gap-3">
                <img
                    v-if="organization?.avatar_url"
                    :src="organization.avatar_url"
                    :alt="organization.name"
                    class="h-8 w-8 rounded-full"
                />
                <h1 class="text-2xl font-medium text-zinc-100">Select Repositories</h1>
            </div>
            <p class="mt-2 text-zinc-400">
                Choose which repositories to enable for Lien Review.
            </p>

            <div v-if="Object.keys(form.errors).length" class="mt-4 rounded-lg border border-red-500/20 bg-red-900/30 p-4">
                <p v-for="(error, key) in form.errors" :key="key" class="text-sm text-red-400">{{ error }}</p>
            </div>

            <div v-if="repositories?.length" class="mt-8 space-y-2">
                <button
                    class="mb-2 text-sm font-medium text-brand-400 hover:text-brand-300"
                    @click="toggleAll"
                >
                    {{ allSelected ? 'Deselect all' : 'Select all' }}
                </button>
            </div>

            <div v-if="repositories?.length" class="space-y-2">
                <button
                    v-for="repo in repositories"
                    :key="repo.id"
                    role="checkbox"
                    :aria-checked="isSelected(repo.id)"
                    class="flex w-full items-center gap-4 rounded-lg border p-4 text-left transition-colors"
                    :class="isSelected(repo.id)
                        ? 'border-brand-500 bg-brand-950'
                        : 'border-zinc-800 bg-zinc-900 hover:border-zinc-700 hover:bg-zinc-800/50'"
                    @click="toggle(repo)"
                >
                    <div class="flex h-5 w-5 shrink-0 items-center justify-center rounded border"
                        :class="isSelected(repo.id)
                            ? 'border-brand-500 bg-brand-500'
                            : 'border-zinc-700'"
                    >
                        <svg v-if="isSelected(repo.id)" aria-hidden="true" class="h-3 w-3 text-white" fill="currentColor" viewBox="0 0 20 20">
                            <path fill-rule="evenodd" d="M16.707 5.293a1 1 0 010 1.414l-8 8a1 1 0 01-1.414 0l-4-4a1 1 0 011.414-1.414L8 12.586l7.293-7.293a1 1 0 011.414 0z" clip-rule="evenodd" />
                        </svg>
                    </div>
                    <div class="min-w-0 flex-1">
                        <div class="font-medium text-zinc-100">{{ repo.name }}</div>
                        <div v-if="repo.description" class="truncate text-sm text-zinc-400">
                            {{ repo.description }}
                        </div>
                    </div>
                    <span
                        v-if="repo.private"
                        class="rounded bg-zinc-800 px-2 py-0.5 text-xs font-medium text-zinc-400"
                    >
                        Private
                    </span>
                </button>
            </div>

            <div class="mt-6 flex items-center gap-4">
                <button
                    :disabled="selectedIds.length === 0 || form.processing"
                    class="rounded-md bg-brand-500 px-4 py-2 text-sm font-medium text-white transition-colors hover:bg-brand-600 disabled:opacity-50"
                    @click="submit"
                >
                    {{ form.processing ? 'Setting up...' : `Enable ${selectedIds.length} repositor${selectedIds.length === 1 ? 'y' : 'ies'}` }}
                </button>
                <Link
                    href="/onboarding/organizations"
                    class="text-sm text-zinc-500 transition-colors hover:text-zinc-300"
                >
                    Back
                </Link>
            </div>
        </div>
    </AuthenticatedLayout>
</template>
