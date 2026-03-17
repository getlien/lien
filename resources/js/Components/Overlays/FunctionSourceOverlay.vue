<script setup>
import { ref, watch, onMounted, onUnmounted } from 'vue'
import axios from 'axios'

const props = defineProps({
    repositoryId: { type: Number, required: true },
    functionData: { type: Object, required: true },
})

const emit = defineEmits(['close'])

const loading = ref(false)
const error = ref(null)
const sourceData = ref(null)
const highlightedHtml = ref('')
let abortController = null
let previousOverflow = ''

watch(() => props.functionData, (fn) => {
    if (fn) fetchSource(fn)
}, { immediate: true })

async function fetchSource(fn) {
    if (abortController) abortController.abort()
    abortController = new AbortController()
    const signal = abortController.signal

    loading.value = true
    error.value = null
    sourceData.value = null
    highlightedHtml.value = ''

    try {
        const response = await axios.get(`/repos/${props.repositoryId}/functions/${fn.id}/source`, { signal })
        sourceData.value = response.data
        await highlightCode(response.data.source, response.data.language, response.data.line_start)
    } catch (err) {
        if (axios.isCancel(err)) return
        error.value = err.response?.data?.error || 'Failed to load source code.'
    } finally {
        if (!signal.aborted) loading.value = false
    }
}

let highlighterPromise = null

function getHighlighter() {
    if (!highlighterPromise) {
        highlighterPromise = (async () => {
            const [{ createHighlighterCore }, { createOnigurumaEngine }] = await Promise.all([
                import('shiki/core'),
                import('shiki/engine/oniguruma'),
            ])

            return createHighlighterCore({
                themes: [import('shiki/themes/github-dark.mjs')],
                langs: [
                    import('shiki/langs/typescript.mjs'),
                    import('shiki/langs/javascript.mjs'),
                    import('shiki/langs/php.mjs'),
                    import('shiki/langs/python.mjs'),
                    import('shiki/langs/ruby.mjs'),
                    import('shiki/langs/go.mjs'),
                    import('shiki/langs/rust.mjs'),
                    import('shiki/langs/java.mjs'),
                    import('shiki/langs/kotlin.mjs'),
                    import('shiki/langs/swift.mjs'),
                    import('shiki/langs/csharp.mjs'),
                    import('shiki/langs/vue.mjs'),
                ],
                engine: createOnigurumaEngine(import('shiki/wasm')),
            })
        })().catch(() => {
            highlighterPromise = null
            return null
        })
    }

    return highlighterPromise
}

async function highlightCode(code, language, lineStart) {
    try {
        const highlighter = await getHighlighter()
        if (!highlighter) {
            highlightedHtml.value = ''
            return
        }

        const lang = highlighter.getLoadedLanguages().includes(language) ? language : 'plaintext'
        let html = highlighter.codeToHtml(code, {
            lang,
            theme: 'github-dark',
        })
        // Inject counter-reset so line numbers start at the correct line
        html = html.replace('<pre ', `<pre style="counter-reset:line-number ${lineStart - 1}" `)
        highlightedHtml.value = html
    } catch {
        highlightedHtml.value = ''
    }
}

function close() {
    emit('close')
}

function onKeydown(e) {
    if (e.key === 'Escape') close()
}

function severityColor(severity) {
    if (severity === 'error') return 'text-red-400'
    if (severity === 'warning') return 'text-amber-400'
    return 'text-zinc-400'
}

function complexityColor(value) {
    if (value >= 20) return 'text-red-400'
    if (value >= 10) return 'text-amber-400'
    return 'text-zinc-200'
}

onMounted(() => {
    previousOverflow = document.body.style.overflow
    document.body.style.overflow = 'hidden'
    document.addEventListener('keydown', onKeydown)
})

onUnmounted(() => {
    if (abortController) abortController.abort()
    document.body.style.overflow = previousOverflow
    document.removeEventListener('keydown', onKeydown)
})
</script>

<template>
    <Teleport to="body">
        <div class="fixed inset-0 z-50 flex items-center justify-center">
            <!-- Backdrop -->
            <div class="absolute inset-0 bg-black/50" @click="close"></div>

            <!-- Panel -->
            <div class="relative mx-4 flex max-h-[90vh] w-full max-w-4xl flex-col rounded-lg border border-zinc-800 bg-zinc-900 shadow-xl">
                <!-- Header -->
                <div class="flex items-center justify-between border-b border-zinc-800 px-6 py-4">
                    <div class="min-w-0">
                        <h3 class="truncate font-mono text-lg font-semibold text-zinc-100">
                            {{ functionData.symbol_name }}
                        </h3>
                        <p class="mt-1 truncate text-sm text-zinc-400">
                            {{ functionData.filepath }}
                            <span v-if="sourceData">
                                (lines {{ sourceData.line_start }}&ndash;{{ sourceData.line_end }})
                            </span>
                        </p>
                    </div>
                    <button
                        type="button"
                        aria-label="Close"
                        @click="close"
                        class="ml-4 shrink-0 rounded-md p-2 text-zinc-500 hover:bg-zinc-800 hover:text-zinc-300"
                    >
                        <svg class="h-5 w-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                            <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2"
                                  d="M6 18L18 6M6 6l12 12" />
                        </svg>
                    </button>
                </div>

                <!-- Metrics bar -->
                <div class="flex gap-6 border-b border-zinc-800 bg-zinc-800/50 px-6 py-3 text-sm">
                    <div>
                        <span class="text-zinc-400">Cyclomatic:</span>
                        <span class="ml-1 font-semibold" :class="complexityColor(functionData.cyclomatic)">
                            {{ functionData.cyclomatic }}
                        </span>
                    </div>
                    <div>
                        <span class="text-zinc-400">Cognitive:</span>
                        <span class="ml-1 font-semibold text-zinc-200">{{ functionData.cognitive }}</span>
                    </div>
                    <div v-if="functionData.severity && functionData.severity !== 'none'">
                        <span class="text-zinc-400">Severity:</span>
                        <span class="ml-1 font-semibold" :class="severityColor(functionData.severity)">
                            {{ functionData.severity }}
                        </span>
                    </div>
                </div>

                <!-- Content area -->
                <div class="flex-1 overflow-auto">
                    <!-- Loading state -->
                    <div v-if="loading" class="space-y-2 p-6">
                        <div v-for="i in 12" :key="i" class="skeleton-shimmer h-4 rounded"
                             :style="{ width: `${30 + Math.random() * 60}%` }"></div>
                    </div>

                    <!-- Error state -->
                    <div v-else-if="error" class="p-6 text-center text-sm text-red-600">
                        {{ error }}
                    </div>

                    <!-- Source code -->
                    <div v-else-if="sourceData" class="overflow-x-auto">
                        <!-- Shiki-highlighted output -->
                        <div v-if="highlightedHtml"
                             class="source-code text-sm"
                             v-html="highlightedHtml">
                        </div>

                        <!-- Plain text fallback -->
                        <pre v-else class="p-4 text-sm leading-6"><code>{{ sourceData.source }}</code></pre>
                    </div>
                </div>
            </div>
        </div>
    </Teleport>
</template>
