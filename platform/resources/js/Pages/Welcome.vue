<script setup>
import { computed } from 'vue'
import { usePage, Link, Head } from '@inertiajs/vue3'
import LienLogo from '@/Components/LienLogo.vue'

const page = usePage()
const user = computed(() => page.props.auth.user)
</script>

<template>
    <Head title="Lien Review — AI-powered code review" />

    <div class="relative min-h-screen overflow-hidden bg-zinc-950">
        <!-- Atmospheric purple glow -->
        <div class="absolute inset-0 overflow-hidden" aria-hidden="true">
            <div class="absolute left-1/2 top-0 h-[600px] w-[600px] -translate-x-1/2 -translate-y-1/4 rounded-full bg-brand-500/8 blur-[120px]" />
            <div class="absolute left-1/3 top-1/3 h-[300px] w-[300px] -translate-x-1/2 rounded-full bg-brand-700/5 blur-[80px]" />
        </div>

        <!-- Top bar -->
        <nav class="relative z-10 mx-auto flex max-w-6xl items-center justify-between px-6 py-6">
            <LienLogo size="sm" :show-text="false" />
            <Link
                v-if="user"
                href="/dashboard"
                class="rounded-md px-4 py-2 text-sm font-medium text-zinc-400 transition-colors hover:text-zinc-200"
            >
                Dashboard
            </Link>
            <a
                v-else
                href="/auth/github"
                class="rounded-md px-4 py-2 text-sm font-medium text-zinc-400 transition-colors hover:text-zinc-200"
            >
                Sign in
            </a>
        </nav>

        <!-- Hero -->
        <div class="relative z-10 mx-auto max-w-6xl px-6 pb-24 pt-24 sm:pt-32">
            <div class="mx-auto max-w-2xl text-center">
                <h1 class="text-5xl font-medium text-zinc-50 sm:text-5xl">
                    Code review, powered by<br class="hidden sm:block" />
                    semantic understanding.
                </h1>
                <p class="mx-auto mt-6 max-w-lg text-lg text-zinc-400">
                    AI-powered complexity analysis, PR summaries with risk assessment, and architectural insights.
                    Catch what linters miss.
                </p>
                <div class="mt-10">
                    <Link
                        v-if="user"
                        href="/dashboard"
                        class="inline-flex items-center rounded-md bg-brand-500 px-6 py-3 text-sm font-medium text-white transition-colors hover:bg-brand-600"
                    >
                        Go to Dashboard
                    </Link>
                    <a
                        v-else
                        href="/auth/github"
                        class="inline-flex items-center gap-2 rounded-md bg-brand-500 px-6 py-3 text-sm font-medium text-white transition-colors hover:bg-brand-600"
                    >
                        <svg aria-hidden="true" class="h-5 w-5" fill="currentColor" viewBox="0 0 20 20">
                            <path fill-rule="evenodd" d="M10 0C4.477 0 0 4.484 0 10.017c0 4.425 2.865 8.18 6.839 9.504.5.092.682-.217.682-.483 0-.237-.008-.868-.013-1.703-2.782.605-3.369-1.343-3.369-1.343-.454-1.158-1.11-1.466-1.11-1.466-.908-.62.069-.608.069-.608 1.003.07 1.531 1.032 1.531 1.032.892 1.53 2.341 1.088 2.91.832.092-.647.35-1.088.636-1.338-2.22-.253-4.555-1.113-4.555-4.951 0-1.093.39-1.988 1.029-2.688-.103-.253-.446-1.272.098-2.65 0 0 .84-.27 2.75 1.026A9.564 9.564 0 0110 4.844c.85.004 1.705.115 2.504.337 1.909-1.296 2.747-1.027 2.747-1.027.546 1.379.203 2.398.1 2.651.64.7 1.028 1.595 1.028 2.688 0 3.848-2.339 4.695-4.566 4.942.359.31.678.921.678 1.856 0 1.338-.012 2.419-.012 2.747 0 .268.18.58.688.482A10.019 10.019 0 0020 10.017C20 4.484 15.522 0 10 0z" clip-rule="evenodd" />
                        </svg>
                        Sign in with GitHub
                    </a>
                </div>
            </div>
        </div>

        <!-- Features -->
        <div class="relative z-10 mx-auto max-w-6xl px-6 pb-32">
            <div class="grid grid-cols-1 gap-4 sm:grid-cols-3">
                <div class="rounded-lg border border-zinc-800 border-t-brand-800 bg-zinc-900 p-5 transition-colors hover:border-brand-800">
                    <div class="flex h-10 w-10 items-center justify-center rounded-md bg-brand-950">
                        <svg class="h-5 w-5 text-brand-400" fill="none" viewBox="0 0 24 24" stroke="currentColor" stroke-width="1.5">
                            <path stroke-linecap="round" stroke-linejoin="round" d="M7 21a4 4 0 01-4-4V5a2 2 0 012-2h4a2 2 0 012 2v12a4 4 0 01-4 4zm0 0h12a2 2 0 002-2v-4a2 2 0 00-2-2h-2.343M11 7.343l1.657-1.657a2 2 0 012.828 0l2.829 2.829a2 2 0 010 2.828l-8.486 8.485M7 17h.01" />
                        </svg>
                    </div>
                    <h3 class="mt-4 text-base font-medium text-zinc-100">Complexity Analysis</h3>
                    <p class="mt-2 text-base text-zinc-400">
                        AST-powered cyclomatic and cognitive complexity tracking. Spot functions that are growing too complex before they become unmaintainable.
                    </p>
                </div>

                <div class="rounded-lg border border-zinc-800 border-t-brand-800 bg-zinc-900 p-5 transition-colors hover:border-brand-800">
                    <div class="flex h-10 w-10 items-center justify-center rounded-md bg-brand-950">
                        <svg class="h-5 w-5 text-brand-400" fill="none" viewBox="0 0 24 24" stroke="currentColor" stroke-width="1.5">
                            <path stroke-linecap="round" stroke-linejoin="round" d="M9 12.75 11.25 15 15 9.75m-3-7.036A11.959 11.959 0 0 1 3.598 6 11.99 11.99 0 0 0 3 9.749c0 5.592 3.824 10.29 9 11.623 5.176-1.332 9-6.03 9-11.622 0-1.31-.21-2.571-.598-3.751h-.152c-3.196 0-6.1-1.248-8.25-3.285Z" />
                        </svg>
                    </div>
                    <h3 class="mt-4 text-base font-medium text-zinc-100">PR Summary</h3>
                    <p class="mt-2 text-base text-zinc-400">
                        Auto-generated pull request summaries with risk assessment. See what changed, what's risky, and what needs attention — before you review.
                    </p>
                </div>

                <div class="rounded-lg border border-zinc-800 border-t-brand-800 bg-zinc-900 p-5 transition-colors hover:border-brand-800">
                    <div class="flex h-10 w-10 items-center justify-center rounded-md bg-brand-950">
                        <svg class="h-5 w-5 text-brand-400" fill="none" viewBox="0 0 24 24" stroke="currentColor" stroke-width="1.5">
                            <path stroke-linecap="round" stroke-linejoin="round" d="M2.25 7.125C2.25 6.504 2.754 6 3.375 6h6c.621 0 1.125.504 1.125 1.125v3.75c0 .621-.504 1.125-1.125 1.125h-6a1.125 1.125 0 01-1.125-1.125v-3.75zM14.25 8.625c0-.621.504-1.125 1.125-1.125h5.25c.621 0 1.125.504 1.125 1.125v8.25c0 .621-.504 1.125-1.125 1.125h-5.25a1.125 1.125 0 01-1.125-1.125v-8.25zM3.75 16.125c0-.621.504-1.125 1.125-1.125h5.25c.621 0 1.125.504 1.125 1.125v2.25c0 .621-.504 1.125-1.125 1.125h-5.25a1.125 1.125 0 01-1.125-1.125v-2.25z" />
                        </svg>
                    </div>
                    <h3 class="mt-4 text-base font-medium text-zinc-100">Architectural Insights</h3>
                    <p class="mt-2 text-base text-zinc-400">
                        Detects structural drift, dependency tangles, and layer violations. Keeps your codebase aligned with its intended architecture.
                    </p>
                </div>
            </div>
        </div>
    </div>
</template>
