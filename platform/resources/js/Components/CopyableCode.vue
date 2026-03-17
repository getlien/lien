<script setup>
import { useToast } from '@/composables/useToast'

const props = defineProps({
    text: { type: String, required: true },
    display: { type: String, default: null },
})

const { success } = useToast()

async function copy() {
    try {
        await navigator.clipboard.writeText(props.text)
        success('Copied!')
    } catch {
        // Fallback for older browsers
        const textarea = document.createElement('textarea')
        textarea.value = props.text
        textarea.style.position = 'fixed'
        textarea.style.opacity = '0'
        document.body.appendChild(textarea)
        textarea.select()
        const ok = document.execCommand('copy')
        document.body.removeChild(textarea)
        if (ok) success('Copied!')
    }
}
</script>

<template>
    <span class="group/copy inline-flex items-center gap-1">
        <code class="rounded bg-zinc-800 px-1.5 py-0.5 font-mono text-xs text-brand-300">
            <slot>{{ display || text }}</slot>
        </code>
        <button
            @click.stop="copy"
            class="inline-flex items-center justify-center rounded p-0.5 text-zinc-500 opacity-0 transition-opacity hover:text-zinc-300 focus-visible:opacity-100 group-hover/copy:opacity-100 group-focus-within/copy:opacity-100"
            aria-label="Copy to clipboard"
            type="button"
        >
            <svg class="h-3.5 w-3.5" fill="none" viewBox="0 0 24 24" stroke="currentColor" stroke-width="1.5" aria-hidden="true">
                <path stroke-linecap="round" stroke-linejoin="round" d="M15.666 3.888A2.25 2.25 0 0013.5 2.25h-3c-1.03 0-1.9.693-2.166 1.638m7.332 0c.055.194.084.4.084.612v0a.75.75 0 01-.75.75H9.75a.75.75 0 01-.75-.75v0c0-.212.03-.418.084-.612m7.332 0c.646.049 1.288.11 1.927.184 1.1.128 1.907 1.077 1.907 2.185V19.5a2.25 2.25 0 01-2.25 2.25H6.75A2.25 2.25 0 014.5 19.5V6.257c0-1.108.806-2.057 1.907-2.185a48.208 48.208 0 011.927-.184" />
            </svg>
        </button>
    </span>
</template>
