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
    width: { type: Number, default: 80 },
    height: { type: Number, default: 24 },
})

const chartData = computed(() => ({
    labels: props.data.map((_, i) => i),
    datasets: [
        {
            data: props.data,
            borderColor: '#c084fc',
            backgroundColor: 'rgba(168, 85, 247, 0.1)',
            fill: true,
            tension: 0.3,
            pointRadius: 0,
            borderWidth: 1.5,
        },
    ],
}))

const chartOptions = {
    responsive: false,
    maintainAspectRatio: false,
    animation: { duration: 0 },
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
    <span>
        <span v-if="data.length < 2" class="text-zinc-500">&mdash;</span>
        <Line
            v-else
            :data="chartData"
            :options="chartOptions"
            :style="{ width: width + 'px', height: height + 'px' }"
        />
    </span>
</template>
