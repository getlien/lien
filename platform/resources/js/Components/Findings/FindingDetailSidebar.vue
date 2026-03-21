<script setup>
import { ref, watch, onMounted, onUnmounted } from 'vue';
import axios from 'axios';
import { timeAgo, formatFullDate } from '@/utils/runs';

const props = defineProps({
  finding: { type: Object, default: null },
});

const emit = defineEmits(['close']);

const sourceLoading = ref(false);
const sourceError = ref(null);
const sourceData = ref(null);
const highlightedHtml = ref('');
let abortController = null;

const typeConfig = {
  bugs: { label: 'bug', color: 'bg-red-900/30 text-red-400' },
  architectural: { label: 'arch', color: 'bg-cyan-900/30 text-cyan-400' },
  complexity: { label: 'complexity', color: 'bg-amber-900/30 text-amber-400' },
  summary: { label: 'summary', color: 'bg-brand-900/30 text-brand-400' },
};

const resolutionConfig = {
  resolved: { label: 'Resolved', color: 'bg-green-900/30 text-green-400' },
  auto_resolved: { label: 'Auto-resolved', color: 'bg-green-900/30 text-green-400' },
  dismissed: { label: 'Dismissed', color: 'bg-zinc-700 text-zinc-400' },
};

const statusConfig = {
  posted: { label: 'Posted', color: 'bg-green-900/30 text-green-400' },
  suppressed: { label: 'Suppressed', color: 'bg-amber-900/30 text-amber-400' },
  skipped: { label: 'Skipped', color: 'bg-zinc-700 text-zinc-400' },
  deduped: { label: 'Deduped', color: 'bg-zinc-700 text-zinc-400' },
};

function typeBadge(type) {
  return typeConfig[type] ?? { label: type, color: 'bg-zinc-700 text-zinc-400' };
}

function statusLabel(finding) {
  if (finding.resolution) {
    return (
      resolutionConfig[finding.resolution] ?? {
        label: finding.resolution,
        color: 'bg-zinc-700 text-zinc-400',
      }
    );
  }
  return (
    statusConfig[finding.status] ?? { label: finding.status, color: 'bg-zinc-700 text-zinc-400' }
  );
}

function close() {
  emit('close');
}

// Source code fetching
watch(
  () => props.finding,
  (val, old) => {
    if (val && val !== old) {
      if (val.filepath && val.line && val.repository_id) {
        fetchSource(val);
      } else {
        sourceData.value = null;
        highlightedHtml.value = '';
      }
    }
    if (!val) {
      sourceData.value = null;
      highlightedHtml.value = '';
      sourceError.value = null;
    }
  },
);

async function fetchSource(finding) {
  if (abortController) abortController.abort();
  abortController = new AbortController();
  const signal = abortController.signal;

  sourceLoading.value = true;
  sourceError.value = null;
  sourceData.value = null;
  highlightedHtml.value = '';

  try {
    const response = await axios.get(
      `/repos/${finding.repository_id}/findings/${finding.id}/source`,
      { signal },
    );
    sourceData.value = response.data;
    await highlightCode(
      response.data.source,
      response.data.language,
      response.data.line_start,
      response.data.highlight_line,
      response.data.diff_lines ?? [],
    );
  } catch (err) {
    if (axios.isCancel(err)) return;
    sourceError.value = err.response?.data?.error || 'Failed to load source code.';
  } finally {
    if (!signal.aborted) sourceLoading.value = false;
  }
}

let highlighterPromise = null;

function getHighlighter() {
  if (!highlighterPromise) {
    highlighterPromise = (async () => {
      const [{ createHighlighterCore }, { createOnigurumaEngine }] = await Promise.all([
        import('shiki/core'),
        import('shiki/engine/oniguruma'),
      ]);

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
      });
    })().catch(() => {
      highlighterPromise = null;
      return null;
    });
  }

  return highlighterPromise;
}

async function highlightCode(code, language, lineStart, highlightLine, diffLines = []) {
  try {
    const highlighter = await getHighlighter();
    if (!highlighter) {
      highlightedHtml.value = '';
      return;
    }

    const lang = highlighter.getLoadedLanguages().includes(language) ? language : 'plaintext';
    const lineCount = code.split('\n').length;
    const decorations = [];

    // Diff line decorations (green background for added lines)
    for (const l of diffLines) {
      if (l >= lineStart && l - lineStart < lineCount) {
        decorations.push({
          start: { line: l - lineStart, character: 0 },
          end: { line: l - lineStart + 1, character: 0 },
          properties: { class: 'diff-add-line' },
        });
      }
    }

    // Finding line decoration (brand purple highlight — renders on top of diff)
    if (highlightLine >= lineStart && highlightLine - lineStart < lineCount) {
      decorations.push({
        start: { line: highlightLine - lineStart, character: 0 },
        end: { line: highlightLine - lineStart + 1, character: 0 },
        properties: { class: 'finding-highlight-line' },
      });
    }

    let html = highlighter.codeToHtml(code, {
      lang,
      theme: 'github-dark',
      decorations,
    });
    html = html.replace('<pre ', `<pre style="counter-reset:line-number ${lineStart - 1}" `);
    highlightedHtml.value = html;
  } catch {
    highlightedHtml.value = '';
  }
}

// Scroll lock
let previousOverflow = '';

watch(
  () => props.finding,
  (val, old) => {
    if (val && !old) {
      previousOverflow = document.body.style.overflow;
      document.body.style.overflow = 'hidden';
    } else if (!val && old) {
      document.body.style.overflow = previousOverflow;
    }
  },
);

function onKeydown(e) {
  if (e.key === 'Escape' && props.finding) {
    close();
  }
}

onMounted(() => document.addEventListener('keydown', onKeydown));
onUnmounted(() => {
  if (abortController) abortController.abort();
  document.removeEventListener('keydown', onKeydown);
  document.body.style.overflow = previousOverflow;
});
</script>

<template>
  <Teleport to="body">
    <!-- Backdrop -->
    <Transition
      enter-active-class="transition-opacity duration-200 ease-out"
      enter-from-class="opacity-0"
      leave-active-class="transition-opacity duration-150 ease-in"
      leave-to-class="opacity-0"
    >
      <div
        v-if="finding"
        class="fixed inset-0 z-50 bg-black/50"
        aria-hidden="true"
        @click="close"
      />
    </Transition>

    <!-- Panel -->
    <Transition
      enter-active-class="slideover-enter-active"
      enter-from-class="slideover-enter-from"
      leave-active-class="slideover-leave-active"
      leave-to-class="slideover-leave-to"
    >
      <aside
        v-if="finding"
        class="fixed inset-y-0 right-0 z-50 flex w-full max-w-xl flex-col border-l border-zinc-700 bg-zinc-800 shadow-xl"
        role="dialog"
        aria-modal="true"
        aria-label="Finding details"
      >
        <!-- Header -->
        <div class="flex items-start justify-between border-b border-zinc-700 px-5 py-4">
          <div class="min-w-0">
            <div class="flex items-center gap-2">
              <span
                :class="[
                  'shrink-0 rounded px-2 py-0.5 text-xs font-medium',
                  typeBadge(finding.review_type).color,
                ]"
              >
                {{ typeBadge(finding.review_type).label }}
              </span>
              <span v-if="finding.filepath" class="truncate font-mono text-sm text-zinc-300">
                {{ finding.filepath
                }}<span v-if="finding.line" class="text-zinc-500">:{{ finding.line }}</span>
              </span>
            </div>
            <p v-if="finding.symbol_name" class="mt-1.5 font-mono text-xs text-zinc-400">
              {{ finding.symbol_name }}
            </p>
          </div>
          <button
            type="button"
            class="ml-4 shrink-0 rounded-md p-1.5 text-zinc-500 transition-colors hover:bg-zinc-700 hover:text-zinc-300"
            aria-label="Close finding details"
            @click="close"
          >
            <svg
              class="h-5 w-5"
              fill="none"
              viewBox="0 0 24 24"
              stroke="currentColor"
              stroke-width="1.5"
            >
              <path stroke-linecap="round" stroke-linejoin="round" d="M6 18L18 6M6 6l12 12" />
            </svg>
          </button>
        </div>

        <!-- Meta -->
        <div class="flex flex-wrap items-center gap-x-4 gap-y-2 border-b border-zinc-700 px-5 py-3">
          <span v-if="finding.repository_name" class="text-sm text-zinc-300">
            {{ finding.repository_name }}
          </span>
          <span v-if="finding.pr_number" class="text-sm text-zinc-400">
            PR #{{ finding.pr_number }}
            <span v-if="finding.pr_title" class="text-zinc-500"
              >&middot; {{ finding.pr_title }}</span
            >
          </span>
          <span :class="['rounded px-2 py-0.5 text-xs font-medium', statusLabel(finding).color]">
            {{ statusLabel(finding).label }}
          </span>
          <span class="ml-auto text-xs text-zinc-500" :title="formatFullDate(finding.created_at)">
            {{ timeAgo(finding.created_at) }}
          </span>
        </div>

        <!-- Scrollable content -->
        <div class="flex-1 overflow-y-auto">
          <!-- Body -->
          <div class="border-b border-zinc-700 px-5 py-5">
            <div class="whitespace-pre-wrap text-sm leading-relaxed text-zinc-200">
              {{ finding.body }}
            </div>
          </div>

          <!-- Source code -->
          <div v-if="finding.filepath && finding.line">
            <div class="flex items-center gap-2 px-5 py-3">
              <svg
                class="h-4 w-4 text-zinc-500"
                fill="none"
                viewBox="0 0 24 24"
                stroke="currentColor"
                stroke-width="1.5"
              >
                <path
                  stroke-linecap="round"
                  stroke-linejoin="round"
                  d="M17.25 6.75L22.5 12l-5.25 5.25m-10.5 0L1.5 12l5.25-5.25m7.5-3l-4.5 16.5"
                />
              </svg>
              <span class="text-xs font-medium text-zinc-400">Source</span>
            </div>

            <!-- Loading -->
            <div v-if="sourceLoading" class="space-y-2 px-5 pb-5">
              <div
                v-for="i in 8"
                :key="i"
                class="skeleton-shimmer h-4 rounded"
                :style="{ width: `${30 + Math.random() * 60}%` }"
              />
            </div>

            <!-- Error -->
            <div v-else-if="sourceError" class="px-5 pb-5 text-sm text-zinc-500">
              {{ sourceError }}
            </div>

            <!-- Highlighted source -->
            <div v-else-if="sourceData" class="overflow-x-auto">
              <div v-if="highlightedHtml" class="source-code text-sm" v-html="highlightedHtml" />
              <pre v-else class="p-4 text-sm leading-6"><code>{{ sourceData.source }}</code></pre>
            </div>
          </div>
        </div>
      </aside>
    </Transition>
  </Teleport>
</template>
