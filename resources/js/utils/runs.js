export function statusBadge(status) {
    return {
        pending: 'bg-zinc-800 text-zinc-400',
        running: 'bg-blue-900/30 text-blue-400',
        completed: 'bg-green-900/30 text-green-400',
        failed: 'bg-red-900/30 text-red-400',
    }[status] || 'bg-zinc-800 text-zinc-400'
}

export function formatDuration(seconds) {
    if (seconds == null) return '—'
    if (seconds < 60) return `${seconds}s`
    const mins = Math.floor(seconds / 60)
    const secs = seconds % 60
    return secs > 0 ? `${mins}m ${secs}s` : `${mins}m`
}

export function timeAgo(iso) {
    if (!iso) return '—'
    const diff = Date.now() - new Date(iso).getTime()
    const mins = Math.floor(diff / 60000)
    if (mins < 1) return 'just now'
    if (mins < 60) return `${mins}m ago`
    const hours = Math.floor(mins / 60)
    if (hours < 24) return `${hours}h ago`
    const days = Math.floor(hours / 24)
    return `${days}d ago`
}

export function formatFullDate(iso) {
    if (!iso) return ''
    return new Date(iso).toLocaleString(undefined, {
        year: 'numeric', month: 'long', day: 'numeric',
        hour: '2-digit', minute: '2-digit', second: '2-digit',
    })
}

export function runLabel(run) {
    if (run.pr_number) return `PR #${run.pr_number}`
    return `#${run.id}`
}

export function complexityDelta(delta) {
    if (delta == null || delta === 0) return null
    return `${delta > 0 ? '+' : ''}${delta.toFixed(1)}`
}

export function formatDelta(value) {
    if (value == null) return null
    const num = Number(value)
    if (num > 0) return `+${num}`
    return String(num)
}

export function deltaColor(value) {
    if (value == null) return 'text-zinc-400'
    const num = Number(value)
    if (num < 0) return 'text-green-400'
    if (num > 0) return 'text-red-400'
    return 'text-zinc-400'
}
