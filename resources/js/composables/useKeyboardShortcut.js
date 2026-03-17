import { onMounted, onUnmounted } from 'vue'

export function useKeyboardShortcut(key, callback, { meta = false, ctrl = false } = {}) {
    function handler(e) {
        if (meta && !e.metaKey) return
        if (ctrl && !e.ctrlKey) return
        if (e.key.toLowerCase() !== key.toLowerCase()) return

        e.preventDefault()
        callback(e)
    }

    onMounted(() => document.addEventListener('keydown', handler))
    onUnmounted(() => document.removeEventListener('keydown', handler))
}
