import { ref } from 'vue'

const toasts = ref([])
let nextId = 0

export function useToast() {
    function success(message) {
        addToast(message, 'success')
    }

    function error(message) {
        addToast(message, 'error')
    }

    function addToast(message, type) {
        const id = ++nextId
        toasts.value.push({ id, message, type })
        setTimeout(() => remove(id), 4000)
    }

    function remove(id) {
        toasts.value = toasts.value.filter(t => t.id !== id)
    }

    return { toasts, success, error, remove }
}
