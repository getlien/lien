<script setup>
import { ref } from 'vue';
import { Deferred, Link, usePoll, Head, router } from '@inertiajs/vue3';
import AuthenticatedLayout from '@/Layouts/AuthenticatedLayout.vue';
import Breadcrumbs from '@/Components/Breadcrumbs.vue';
import ComplexityTrendChart from '@/Components/Charts/ComplexityTrendChart.vue';
import TopFunctionsTable from '@/Components/Tables/TopFunctionsTable.vue';
import RecentRunsTable from '@/Components/Tables/RecentRunsTable.vue';
import RecentFindingsFeed from '@/Components/Dashboard/RecentFindingsFeed.vue';
import FindingDetailSidebar from '@/Components/Findings/FindingDetailSidebar.vue';
import FunctionSourceOverlay from '@/Components/Overlays/FunctionSourceOverlay.vue';
import StatCard from '@/Components/StatCard.vue';
import SkeletonChart from '@/Components/Skeletons/SkeletonChart.vue';
import SkeletonTable from '@/Components/Skeletons/SkeletonTable.vue';
import SkeletonStatGrid from '@/Components/Skeletons/SkeletonStatGrid.vue';

const selectedFunction = ref(null);
const selectedFinding = ref(null);

const props = defineProps({
  repository: Object,
  organization: Object,
  lastReviewDate: String,
  totalRuns: Number,
  baselineProgress: Object,
  trendData: Array,
  topFunctions: Array,
  clusterMapData: Array,
  recentRuns: Array,
  recentFindings: Array,
  range: Number,
  reviewActivity: Object,
  costTracking: Object,
});

function setRange(n) {
  router.reload({ data: { range: n }, only: ['reviewActivity', 'costTracking', 'range'] });
}

const { stop, start } = usePoll(5000, {}, { autoStart: false });

if (props.baselineProgress?.is_generating) {
  start();
}

function formatDate(iso) {
  if (!iso) return 'Never';
  return new Date(iso).toLocaleDateString(undefined, {
    year: 'numeric',
    month: 'short',
    day: 'numeric',
  });
}

function formatCost(value) {
  return `$${Number(value).toFixed(2)}`;
}

function formatTokens(value) {
  if (value >= 1000000) return `${(value / 1000000).toFixed(1)}M`;
  if (value >= 1000) return `${(value / 1000).toFixed(1)}K`;
  return String(value);
}

function baselinePercent() {
  if (!props.baselineProgress || props.baselineProgress.total === 0) return 0;
  return (props.baselineProgress.completed / props.baselineProgress.total) * 100;
}
</script>

<template>
  <Head :title="`${repository.full_name} — Lien Review`" />

  <AuthenticatedLayout>
    <div>
      <Breadcrumbs
        :items="[{ label: 'Dashboard', href: '/dashboard' }, { label: repository.full_name }]"
        class="mb-4"
      />
      <div class="flex items-center justify-between">
        <div>
          <h1 class="text-2xl font-medium text-zinc-100">{{ repository.full_name }}</h1>
          <p class="mt-1 text-sm text-zinc-400">
            Last reviewed {{ formatDate(lastReviewDate) }} &middot; {{ totalRuns }} total runs
          </p>
        </div>
      </div>

      <div
        v-if="baselineProgress?.is_generating"
        class="mt-8 rounded-lg border border-brand-500/20 bg-brand-950 p-5"
      >
        <div class="flex items-center gap-3">
          <svg
            class="h-5 w-5 animate-spin text-brand-500"
            xmlns="http://www.w3.org/2000/svg"
            fill="none"
            viewBox="0 0 24 24"
          >
            <circle
              class="opacity-25"
              cx="12"
              cy="12"
              r="10"
              stroke="currentColor"
              stroke-width="4"
            />
            <path
              class="opacity-75"
              fill="currentColor"
              d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4z"
            />
          </svg>
          <div>
            <p class="font-medium text-brand-400">Analyzing your codebase</p>
            <p class="text-sm text-zinc-400">
              {{ baselineProgress.completed }} of {{ baselineProgress.total }} baseline analyses
              complete. Charts and insights will appear as results come in.
            </p>
          </div>
        </div>
        <div class="mt-3 h-2 w-full rounded-full bg-zinc-800">
          <div
            class="h-2 rounded-full bg-brand-500 transition-all duration-500"
            :style="{ width: `${baselinePercent()}%` }"
          />
        </div>
      </div>

      <Deferred :data="['trendData', 'topFunctions']">
        <template #fallback>
          <div class="mt-8 grid gap-6 3xl:grid-cols-2">
            <SkeletonChart />
            <SkeletonTable />
          </div>
        </template>

        <div class="mt-8 grid gap-6 deferred-enter 3xl:grid-cols-2">
          <div>
            <ComplexityTrendChart v-if="trendData?.length" :data="trendData" />
            <div
              v-else-if="!baselineProgress?.is_generating"
              class="rounded-lg border border-zinc-800 bg-zinc-900 p-12 text-center"
            >
              <svg
                class="mx-auto h-10 w-10 text-zinc-500"
                fill="none"
                viewBox="0 0 24 24"
                stroke="currentColor"
                stroke-width="1"
                aria-hidden="true"
              >
                <path
                  stroke-linecap="round"
                  stroke-linejoin="round"
                  d="M2.25 18L9 11.25l4.306 4.307a11.95 11.95 0 015.814-5.519l2.74-1.22m0 0l-5.94-2.28m5.94 2.28l-2.28 5.941"
                />
              </svg>
              <p class="mt-3 text-sm text-zinc-400">
                Open a pull request to trigger your first review, or check back after baselines
                complete.
              </p>
            </div>
          </div>

          <TopFunctionsTable
            :functions="topFunctions"
            :cluster-map-data="clusterMapData"
            @select="selectedFunction = $event"
          />
        </div>
      </Deferred>

      <Deferred :data="['reviewActivity', 'costTracking']">
        <template #fallback>
          <div class="mt-8">
            <SkeletonStatGrid />
          </div>
        </template>

        <div class="mt-8 deferred-enter">
          <div class="flex items-center justify-between">
            <h2 class="text-lg font-medium text-zinc-100">Activity & Cost ({{ range }}d)</h2>
            <div class="flex items-center gap-1">
              <button
                v-for="n in [7, 30, 90]"
                :key="n"
                type="button"
                :aria-pressed="range === n"
                class="rounded-full px-3 py-1 text-sm font-medium transition-colors"
                :class="
                  range === n ? 'bg-zinc-700 text-zinc-100' : 'text-zinc-400 hover:text-zinc-200'
                "
                @click="setRange(n)"
              >
                {{ n }}d
              </button>
            </div>
          </div>
          <div class="mt-3 grid grid-cols-2 gap-4 lg:grid-cols-5">
            <StatCard label="PRs Reviewed" :value="reviewActivity?.distinct_prs ?? 0" />
            <StatCard label="Comments Posted" :value="reviewActivity?.comments_posted ?? 0" />
            <StatCard label="Total Tokens" :value="formatTokens(costTracking?.total_tokens ?? 0)" />
            <StatCard label="Total Cost" :value="formatCost(costTracking?.total_cost ?? 0)" />
            <StatCard label="Review Runs" :value="costTracking?.total_runs ?? 0" />
          </div>
        </div>
      </Deferred>

      <Deferred :data="['recentFindings']">
        <template #fallback>
          <div class="mt-8">
            <SkeletonTable />
          </div>
        </template>
        <div class="mt-8 deferred-enter">
          <div class="flex items-center justify-between">
            <h2 class="text-lg font-medium text-zinc-100">Recent Findings</h2>
            <Link
              :href="`/repos/${repository.id}/findings`"
              class="text-sm font-medium text-brand-400 hover:text-brand-300"
            >
              View all findings &rarr;
            </Link>
          </div>
          <div class="mt-3">
            <RecentFindingsFeed
              v-if="recentFindings"
              :findings="recentFindings"
              @select="selectedFinding = $event"
            />
          </div>
        </div>
      </Deferred>

      <Deferred :data="['recentRuns']">
        <template #fallback>
          <div class="mt-8">
            <SkeletonTable />
          </div>
        </template>

        <div class="mt-8 deferred-enter">
          <RecentRunsTable :runs="recentRuns" :repository-id="repository.id" />
          <div class="mt-3 text-right">
            <Link
              :href="`/repos/${repository.id}/runs`"
              class="text-sm font-medium text-brand-400 hover:text-brand-300"
            >
              View all runs &rarr;
            </Link>
          </div>
        </div>
      </Deferred>
    </div>
    <FunctionSourceOverlay
      v-if="selectedFunction"
      :repository-id="repository.id"
      :function-data="selectedFunction"
      @close="selectedFunction = null"
    />
    <FindingDetailSidebar :finding="selectedFinding" @close="selectedFinding = null" />
  </AuthenticatedLayout>
</template>
