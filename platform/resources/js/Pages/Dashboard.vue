<script setup>
import { Deferred, Link, Head, router } from '@inertiajs/vue3';
import AuthenticatedLayout from '@/Layouts/AuthenticatedLayout.vue';
import ImpactStats from '@/Components/Dashboard/ImpactStats.vue';
import RecentFindingsFeed from '@/Components/Dashboard/RecentFindingsFeed.vue';
import SkeletonStatGrid from '@/Components/Skeletons/SkeletonStatGrid.vue';
import SkeletonTable from '@/Components/Skeletons/SkeletonTable.vue';
import { statusBadge, timeAgo } from '@/utils/runs';

const props = defineProps({
  repositories: Array,
  range: Number,
  impactStats: Object,
  recentFindings: Array,
  recentRuns: Array,
});

function setRange(n) {
  router.get('/dashboard', { range: n }, { preserveState: true });
}
</script>

<template>
  <Head title="Dashboard — Lien Review" />

  <AuthenticatedLayout>
    <div v-if="repositories?.length">
      <div class="flex items-center justify-between">
        <h1 class="text-2xl font-medium text-zinc-100">Overview</h1>
        <div class="flex items-center gap-1">
          <button
            v-for="n in [7, 30, 90]"
            :key="n"
            type="button"
            :aria-pressed="range === n"
            class="rounded-full px-3 py-1 text-sm font-medium transition-colors"
            :class="range === n ? 'bg-zinc-700 text-zinc-100' : 'text-zinc-400 hover:text-zinc-200'"
            @click="setRange(n)"
          >
            {{ n }}d
          </button>
        </div>
      </div>

      <Deferred :data="['impactStats']">
        <template #fallback>
          <SkeletonStatGrid class="mt-6" />
        </template>
        <ImpactStats v-if="impactStats" :stats="impactStats" class="mt-6 deferred-enter" />
      </Deferred>

      <Deferred :data="['recentFindings']">
        <template #fallback>
          <SkeletonTable class="mt-8" />
        </template>
        <div class="mt-8 deferred-enter">
          <div class="flex items-center justify-between">
            <h2 class="text-lg font-medium text-zinc-100">Recent Findings</h2>
            <Link href="/findings" class="text-sm font-medium text-brand-400 hover:text-brand-300">
              View all findings &rarr;
            </Link>
          </div>
          <div class="mt-3">
            <RecentFindingsFeed v-if="recentFindings" :findings="recentFindings" />
          </div>
        </div>
      </Deferred>

      <Deferred :data="['recentRuns']">
        <template #fallback>
          <SkeletonTable class="mt-8" />
        </template>
        <div class="mt-8 deferred-enter">
          <div class="flex items-center justify-between">
            <h2 class="text-lg font-medium text-zinc-100">Recent Runs</h2>
          </div>
          <div
            v-if="recentRuns?.length"
            class="mt-3 overflow-hidden rounded-lg border border-zinc-800"
          >
            <table class="w-full">
              <thead>
                <tr class="border-b border-zinc-800 bg-zinc-900">
                  <th class="px-4 py-2 text-left text-xs font-medium text-zinc-400">PR</th>
                  <th class="px-4 py-2 text-left text-xs font-medium text-zinc-400">Repository</th>
                  <th class="px-4 py-2 text-left text-xs font-medium text-zinc-400">Status</th>
                  <th class="px-4 py-2 text-right text-xs font-medium text-zinc-400">When</th>
                </tr>
              </thead>
              <tbody class="divide-y divide-zinc-800/50">
                <tr
                  v-for="run in recentRuns"
                  :key="run.id"
                  class="transition-colors hover:bg-zinc-800/50"
                >
                  <td class="px-4 py-2.5 text-sm text-zinc-200">
                    <template v-if="run.pr_number">PR #{{ run.pr_number }}</template>
                    <template v-else>
                      <span class="text-zinc-400">{{ run.type }}</span>
                    </template>
                  </td>
                  <td class="px-4 py-2.5 text-sm text-zinc-400">{{ run.repository_name }}</td>
                  <td class="px-4 py-2.5">
                    <span
                      :class="['rounded px-2 py-0.5 text-xs font-medium', statusBadge(run.status)]"
                    >
                      {{ run.status }}
                    </span>
                  </td>
                  <td class="px-4 py-2.5 text-right text-xs text-zinc-500">
                    {{ timeAgo(run.created_at) }}
                  </td>
                </tr>
              </tbody>
            </table>
          </div>
          <div v-else class="mt-3 rounded-lg border border-zinc-800 bg-zinc-900 p-8 text-center">
            <p class="text-sm text-zinc-400">No runs yet.</p>
          </div>
        </div>
      </Deferred>
    </div>

    <div v-else class="mt-8 rounded-lg border border-zinc-800 bg-zinc-900 p-12 text-center">
      <svg
        class="mx-auto h-12 w-12 text-zinc-500"
        fill="none"
        viewBox="0 0 24 24"
        stroke="currentColor"
        stroke-width="1"
        aria-hidden="true"
      >
        <path
          stroke-linecap="round"
          stroke-linejoin="round"
          d="M12 21v-8.25M15.75 21v-8.25M8.25 21v-8.25M3 9l9-6 9 6m-1.5 12V10.332A48.36 48.36 0 0012 9.75c-2.551 0-5.056.2-7.5.582V21M3 21h18M12 6.75h.008v.008H12V6.75z"
        />
      </svg>
      <h2 class="mt-4 text-lg font-medium text-zinc-100">Get started with Lien Review</h2>
      <p class="mt-2 text-sm text-zinc-400">
        Connect your repositories to start getting AI-powered code reviews.
      </p>
      <Link
        href="/onboarding/organizations"
        class="mt-6 inline-flex items-center rounded-md bg-brand-500 px-4 py-2 text-sm font-medium text-white transition-colors hover:bg-brand-600"
      >
        Get Started
      </Link>
    </div>
  </AuthenticatedLayout>
</template>
