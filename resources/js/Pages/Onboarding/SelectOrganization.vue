<script setup>
import { useForm } from '@inertiajs/vue3'
import AuthenticatedLayout from '@/Layouts/AuthenticatedLayout.vue'
import StepIndicator from '@/Components/Onboarding/StepIndicator.vue'

const props = defineProps({
    organizations: Array,
})

const form = useForm({
    login: '',
})

function selectOrg(org) {
    form.login = org.login
    form.post('/onboarding/organizations')
}
</script>

<template>
    <AuthenticatedLayout>
        <div class="mx-auto max-w-2xl">
            <StepIndicator :current-step="1" />

            <h1 class="text-2xl font-medium text-zinc-100">Select an Organization</h1>
            <p class="mt-2 text-zinc-400">
                Choose the GitHub organization you'd like to set up with Lien Review.
            </p>

            <div v-if="Object.keys(form.errors).length" class="mt-4 rounded-lg border border-red-500/20 bg-red-900/30 p-4">
                <p v-for="(error, key) in form.errors" :key="key" class="text-sm text-red-400">{{ error }}</p>
            </div>

            <div v-if="organizations?.length" class="mt-8 space-y-3">
                <button
                    v-for="org in organizations"
                    :key="org.id"
                    class="flex w-full items-center gap-4 rounded-lg border border-zinc-800 bg-zinc-900 p-4 text-left transition-colors hover:border-zinc-700 hover:bg-zinc-800/50"
                    :disabled="form.processing"
                    @click="selectOrg(org)"
                >
                    <img
                        :src="org.avatar_url"
                        :alt="org.login"
                        class="h-10 w-10 rounded-full"
                    />
                    <div>
                        <div class="font-medium text-zinc-100">{{ org.login }}</div>
                        <div v-if="org.description" class="text-sm text-zinc-400">
                            {{ org.description }}
                        </div>
                    </div>
                </button>
            </div>

            <div v-else class="mt-8 rounded-lg border border-zinc-800 bg-zinc-900 p-8 text-center">
                <svg class="mx-auto h-12 w-12 text-zinc-500" fill="none" viewBox="0 0 24 24" stroke="currentColor" stroke-width="1" aria-hidden="true">
                    <path stroke-linecap="round" stroke-linejoin="round" d="M17 20h5v-2a3 3 0 00-5.356-1.857M17 20H7m10 0v-2c0-.656-.126-1.283-.356-1.857M7 20H2v-2a3 3 0 015.356-1.857M7 20v-2c0-.656.126-1.283.356-1.857m0 0a5.002 5.002 0 019.288 0M15 7a3 3 0 11-6 0 3 3 0 016 0z" />
                </svg>
                <h3 class="mt-4 text-sm font-medium text-zinc-200">No organizations found</h3>
                <p class="mt-1 text-sm text-zinc-400">
                    Make sure your GitHub account has access to at least one organization.
                </p>
            </div>
        </div>
    </AuthenticatedLayout>
</template>
