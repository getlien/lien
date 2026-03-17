<script setup>
import { computed } from 'vue'
import { Line } from 'vue-chartjs'
import {
    Chart as ChartJS,
    CategoryScale,
    LinearScale,
    PointElement,
    LineElement,
    Title,
    Tooltip,
    Legend,
    Filler,
} from 'chart.js'

ChartJS.register(CategoryScale, LinearScale, PointElement, LineElement, Title, Tooltip, Legend, Filler)

const prefersReducedMotion = typeof window !== 'undefined'
    && window.matchMedia('(prefers-reduced-motion: reduce)').matches

const props = defineProps({
    data: Array,
})

function createGradient(ctx, color, opacity) {
    const gradient = ctx.createLinearGradient(0, 0, 0, ctx.canvas.clientHeight)
    gradient.addColorStop(0, `rgba(${color}, ${opacity})`)
    gradient.addColorStop(1, `rgba(${color}, 0)`)
    return gradient
}

const chartData = computed(() => ({
    labels: props.data.map(d => d.date),
    datasets: [
        {
            label: 'Avg Complexity',
            data: props.data.map(d => d.avg_complexity),
            borderColor: 'rgb(59, 130, 246)',
            backgroundColor: (ctx) => createGradient(ctx.chart.ctx, '59,130,246', 0.15),
            fill: true,
            tension: 0.3,
            pointRadius: 2,
            pointHoverRadius: 5,
            pointHitRadius: 10,
            pointHoverBorderWidth: 2,
            pointHoverBorderColor: 'rgb(59, 130, 246)',
            pointHoverBackgroundColor: '#18181b',
        },
        {
            label: 'Max Complexity',
            data: props.data.map(d => d.max_complexity),
            borderColor: 'rgb(239, 68, 68)',
            backgroundColor: (ctx) => createGradient(ctx.chart.ctx, '239,68,68', 0.08),
            fill: true,
            tension: 0.3,
            pointRadius: 2,
            pointHoverRadius: 5,
            pointHitRadius: 10,
            pointHoverBorderWidth: 2,
            pointHoverBorderColor: 'rgb(239, 68, 68)',
            pointHoverBackgroundColor: '#18181b',
        },
    ],
}))

const chartOptions = {
    responsive: true,
    maintainAspectRatio: false,
    animation: { duration: prefersReducedMotion ? 0 : 300, easing: 'easeInOutQuad' },
    interaction: {
        mode: 'index',
        intersect: false,
    },
    plugins: {
        legend: {
            position: 'top',
            labels: {
                color: '#a1a1aa',
            },
        },
        tooltip: {
            backgroundColor: '#27272a',
            titleColor: '#f4f4f5',
            bodyColor: '#e4e4e7',
            borderColor: '#3f3f46',
            borderWidth: 1,
            callbacks: {
                title: (items) => {
                    if (!items.length || !props.data[items[0].dataIndex]) return ''
                    const point = props.data[items[0].dataIndex]
                    const label = point.type === 'baseline' ? 'Baseline' : `PR #${point.pr_number}`
                    return `${point.date} (${label})`
                },
            },
        },
    },
    scales: {
        y: {
            beginAtZero: true,
            title: {
                display: true,
                text: 'Cyclomatic Complexity',
                color: '#a1a1aa',
            },
            ticks: { color: '#71717a' },
            grid: { color: '#27272a' },
        },
        x: {
            ticks: {
                maxTicksLimit: 15,
                color: '#71717a',
            },
            grid: { color: '#27272a' },
        },
    },
}
</script>

<template>
    <div class="rounded-lg border border-zinc-800 bg-zinc-900 p-5">
        <h3 class="text-lg font-medium text-zinc-100">Complexity Trend</h3>
        <div class="mt-4 h-72">
            <Line :data="chartData" :options="chartOptions" />
        </div>
    </div>
</template>
