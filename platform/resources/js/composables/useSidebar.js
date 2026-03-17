import { ref } from 'vue'

const STORAGE_KEY = 'lien:sidebar-collapsed'

function readStorage() {
    return typeof window !== 'undefined' && localStorage.getItem(STORAGE_KEY) === 'true'
}

const isCollapsed = ref(readStorage())
const isMobileOpen = ref(false)

export function useSidebar() {
    function toggle() {
        isCollapsed.value = !isCollapsed.value
        if (typeof window !== 'undefined') {
            localStorage.setItem(STORAGE_KEY, isCollapsed.value)
        }
    }

    function openMobile() {
        isMobileOpen.value = true
    }

    function closeMobile() {
        isMobileOpen.value = false
    }

    return {
        isCollapsed,
        isMobileOpen,
        toggle,
        openMobile,
        closeMobile,
    }
}
