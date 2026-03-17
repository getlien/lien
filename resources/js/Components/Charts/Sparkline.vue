<script setup>
import { computed } from 'vue'
import { Line } from 'vue-chartjs'
import {
    Chart as ChartJS,
    CategoryScale,
    LinearScale,
    PointElement,
    LineElement,
    Filler,
} from 'chart.js'

ChartJS.register(CategoryScale, LinearScale, PointElement, LineElement, Filler)

const props = defineProps({
    data: { type: Array, required: true },
    color: { type: String, default: '168,85,247' },
    width: { type: Number, default: 120 },
    height: { type: Number, default: 32 },
})

const chartData = computed(() => ({
    labels: props.data.map((_, i) => i),
    datasets: [
        {
            data: props.data,
            borderColor: `rgb(${props.color})`,
            backgroundColor: (ctx) => {
                if (!ctx.chart?.ctx) return 'transparent'
                const gradient = ctx.chart.ctx.createLinearGradient(0, 0, 0, props.height)
                gradient.addColorStop(0, `rgba(${props.color}, 0.2)`)
                gradient.addColorStop(1, `rgba(${props.color}, 0)`)
                return gradient
            },
            fill: true,
            borderWidth: 1.5,
            tension: 0.3,
            pointRadius: 0,
            pointHitRadius: 0,
        },
    ],
}))

const chartOptions = {
    responsive: false,
    maintainAspectRatio: false,
    animation: false,
    plugins: {
        legend: { display: false },
        tooltip: { enabled: false },
    },
    scales: {
        x: { display: false },
        y: { display: false },
    },
}
</script>

<template>
    <div class="inline-flex items-center">
        <Line
            :data="chartData"
            :options="chartOptions"
            :style="{ width: `${width}px`, height: `${height}px` }"
        />
    </div>
</template>
