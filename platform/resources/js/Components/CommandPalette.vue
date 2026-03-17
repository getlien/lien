<script setup>
import { ref, computed, watch, nextTick } from 'vue'
import { usePage, router } from '@inertiajs/vue3'
import { useKeyboardShortcut } from '@/composables/useKeyboardShortcut'

const isOpen = ref(false)
const query = ref('')
const selectedIndex = ref(0)
const inputRef = ref(null)

const page = usePage()
const sidebar = computed(() => page.props.sidebar ?? [])

const actions = computed(() => {
    const items = [
        { label: 'Dashboard', url: '/dashboard' },
    ]

    for (const org of sidebar.value) {
        for (const repo of org.repositories) {
            items.push(
                { label: repo.full_name, url: `/repos/${repo.id}/dashboard` },
                { label: `${repo.full_name} › Runs`, url: `/repos/${repo.id}/runs` },
                { label: `${repo.full_name} › Config`, url: `/repos/${repo.id}/config` },
            )
        }
    }

    return items
})

const filtered = computed(() => {
    if (!query.value) return actions.value
    const q = query.value.toLowerCase()
    return actions.value.filter(a => a.label.toLowerCase().includes(q))
})

watch(filtered, () => {
    selectedIndex.value = 0
})

function open() {
    isOpen.value = true
    query.value = ''
    selectedIndex.value = 0
    nextTick(() => inputRef.value?.focus())
}

function close() {
    isOpen.value = false
}

function navigate(action) {
    close()
    router.visit(action.url)
}

function onKeydown(e) {
    if (e.key === 'ArrowDown') {
        e.preventDefault()
        selectedIndex.value = Math.min(selectedIndex.value + 1, filtered.value.length - 1)
    } else if (e.key === 'ArrowUp') {
        e.preventDefault()
        selectedIndex.value = Math.max(selectedIndex.value - 1, 0)
    } else if (e.key === 'Enter') {
        e.preventDefault()
        if (filtered.value[selectedIndex.value]) {
            navigate(filtered.value[selectedIndex.value])
        }
    }
}

// Cmd+K (Mac) / Ctrl+K (Windows)
useKeyboardShortcut('k', open, { meta: true })
useKeyboardShortcut('k', open, { ctrl: true })

defineExpose({ open })
</script>

<template>
    <Teleport to="body">
        <Transition
            enter-active-class="transition-opacity duration-200 ease-out"
            enter-from-class="opacity-0"
            leave-active-class="transition-opacity duration-150 ease-in"
            leave-to-class="opacity-0"
        >
            <div
                v-if="isOpen"
                class="fixed inset-0 z-[60] flex items-start justify-center pt-[20vh]"
                role="dialog"
                aria-modal="true"
                aria-label="Command palette"
            >
                <!-- Backdrop -->
                <div class="absolute inset-0 bg-black/60" @click="close" />

                <!-- Panel -->
                <div
                    class="relative w-full max-w-lg overflow-hidden rounded-lg border border-zinc-800 bg-zinc-900 shadow-2xl"
                    @keydown="onKeydown"
                    @keydown.escape="close"
                >
                    <!-- Search input -->
                    <div class="flex items-center border-b border-zinc-800 px-4">
                        <svg class="h-5 w-5 shrink-0 text-zinc-500" fill="none" viewBox="0 0 24 24" stroke="currentColor" stroke-width="1.5">
                            <path stroke-linecap="round" stroke-linejoin="round" d="M21 21l-5.197-5.197m0 0A7.5 7.5 0 105.196 5.196a7.5 7.5 0 0010.607 10.607z" />
                        </svg>
                        <input
                            ref="inputRef"
                            v-model="query"
                            type="text"
                            class="w-full border-0 bg-transparent px-3 py-3.5 text-sm text-zinc-200 placeholder:text-zinc-600 focus:outline-none focus:ring-0"
                            placeholder="Search pages..."
                        />
                    </div>

                    <!-- Results -->
                    <div class="max-h-72 overflow-y-auto py-2">
                        <div v-if="!filtered.length" class="px-4 py-6 text-center text-sm text-zinc-400">
                            No results found.
                        </div>
                        <button
                            v-for="(action, i) in filtered"
                            :key="action.url"
                            type="button"
                            :class="[
                                'flex w-full items-center gap-3 px-4 py-2.5 text-left text-sm transition-colors',
                                i === selectedIndex
                                    ? 'bg-zinc-800 text-zinc-100'
                                    : 'text-zinc-400 hover:bg-zinc-800/50 hover:text-zinc-200',
                            ]"
                            @click="navigate(action)"
                            @mouseenter="selectedIndex = i"
                        >
                            <svg v-if="action.url === '/dashboard'" class="h-4 w-4 shrink-0 text-zinc-500" fill="none" viewBox="0 0 24 24" stroke="currentColor" stroke-width="1.5">
                                <path stroke-linecap="round" stroke-linejoin="round" d="M3.75 6A2.25 2.25 0 016 3.75h2.25A2.25 2.25 0 0110.5 6v2.25a2.25 2.25 0 01-2.25 2.25H6a2.25 2.25 0 01-2.25-2.25V6zM3.75 15.75A2.25 2.25 0 016 13.5h2.25a2.25 2.25 0 012.25 2.25V18a2.25 2.25 0 01-2.25 2.25H6A2.25 2.25 0 013.75 18v-2.25zM13.5 6a2.25 2.25 0 012.25-2.25H18A2.25 2.25 0 0120.25 6v2.25A2.25 2.25 0 0118 10.5h-2.25a2.25 2.25 0 01-2.25-2.25V6zM13.5 15.75a2.25 2.25 0 012.25-2.25H18a2.25 2.25 0 012.25 2.25V18A2.25 2.25 0 0118 20.25h-2.25A2.25 2.25 0 0113.5 18v-2.25z" />
                            </svg>
                            <svg v-else class="h-4 w-4 shrink-0 text-zinc-500" fill="none" viewBox="0 0 24 24" stroke="currentColor" stroke-width="1.5">
                                <path stroke-linecap="round" stroke-linejoin="round" d="M13.5 4.5L21 12m0 0l-7.5 7.5M21 12H3" />
                            </svg>
                            {{ action.label }}
                        </button>
                    </div>

                    <!-- Footer -->
                    <div class="flex items-center gap-4 border-t border-zinc-800 px-4 py-2 text-xs text-zinc-400">
                        <span class="flex items-center gap-1">
                            <kbd class="rounded border border-zinc-700 px-1 py-0.5 font-mono">↑↓</kbd>
                            navigate
                        </span>
                        <span class="flex items-center gap-1">
                            <kbd class="rounded border border-zinc-700 px-1 py-0.5 font-mono">↵</kbd>
                            select
                        </span>
                        <span class="flex items-center gap-1">
                            <kbd class="rounded border border-zinc-700 px-1 py-0.5 font-mono">esc</kbd>
                            close
                        </span>
                    </div>
                </div>
            </div>
        </Transition>
    </Teleport>
</template>
