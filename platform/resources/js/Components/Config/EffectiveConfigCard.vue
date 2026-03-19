<script setup>
import { computed } from 'vue';

const props = defineProps({
  config: {
    type: Object,
    required: true,
  },
});

const planLabel = computed(() => {
  const labels = {
    free: 'Free',
    solo: 'Solo',
    team: 'Team',
    business: 'Business',
    business_plus: 'Business+',
    enterprise: 'Enterprise',
  };
  return labels[props.config.plan] ?? props.config.plan;
});

const planColor = computed(() => {
  const colors = {
    free: 'bg-zinc-800 text-zinc-300',
    solo: 'bg-brand-900/40 text-brand-400',
    team: 'bg-cyan-900/40 text-cyan-400',
    business: 'bg-blue-900/40 text-blue-400',
    business_plus: 'bg-amber-900/40 text-amber-400',
    enterprise: 'bg-amber-900/40 text-amber-400',
  };
  return colors[props.config.plan] ?? 'bg-zinc-800 text-zinc-300';
});

const reviewTypes = computed(() => {
  const types = props.config.reviewTypes ?? {};
  return [
    {
      name: 'Complexity',
      key: 'complexity',
      enabled: types.complexity?.enabled ?? false,
      detail: types.complexity?.threshold ? `threshold: ${types.complexity.threshold}` : null,
      color: 'bg-amber-900/30 text-amber-400',
    },
    {
      name: 'Architectural',
      key: 'architectural',
      enabled: types.architectural?.enabled && types.architectural?.enabled !== 'disabled',
      detail: types.architectural?.enabled === 'auto' ? 'auto mode' : null,
      color: 'bg-cyan-900/30 text-cyan-400',
    },
    {
      name: 'PR Summary',
      key: 'summary',
      enabled: types.summary?.enabled ?? false,
      detail: null,
      color: 'bg-brand-900/30 text-brand-400',
    },
    {
      name: 'Bug Finder',
      key: 'bugs',
      enabled: types.bugs?.enabled ?? false,
      detail: null,
      color: 'bg-red-900/30 text-red-400',
    },
  ];
});

const features = computed(() => {
  const f = props.config.features ?? {};
  return [
    { name: 'Org Management', enabled: f.orgManagement ?? false },
    { name: 'Custom Rules', enabled: f.customRules ?? false },
    {
      name:
        f.trendRetentionDays === null
          ? 'Unlimited Trend Retention'
          : `${f.trendRetentionDays ?? 30}d Trend Retention`,
      enabled: true,
    },
  ];
});
</script>

<template>
  <div class="rounded-lg border border-zinc-800 bg-zinc-900 p-5">
    <div class="flex items-center justify-between">
      <h2 class="text-lg font-medium text-zinc-100">Effective Configuration</h2>
      <span :class="['rounded-full px-3 py-1 text-xs font-medium', planColor]">
        {{ planLabel }}
      </span>
    </div>
    <p class="mt-1 text-sm text-zinc-400">The merged configuration used by the review engine.</p>

    <!-- Review Quotas -->
    <div class="mt-5 flex flex-wrap gap-4">
      <div
        v-if="'complexityReviewsRemaining' in config"
        class="rounded-lg border border-zinc-800 bg-zinc-950 px-4 py-3"
      >
        <p class="text-xs text-zinc-400">Complexity Reviews</p>
        <p class="mt-1 text-lg font-medium text-zinc-100">
          {{
            config.complexityReviewsRemaining === null
              ? 'Unlimited'
              : config.complexityReviewsRemaining
          }}
          <span class="text-sm text-zinc-500">remaining</span>
        </p>
      </div>
      <div
        v-if="
          config.managedLlmReviewsRemaining !== null &&
          config.managedLlmReviewsRemaining !== undefined
        "
        class="rounded-lg border border-zinc-800 bg-zinc-950 px-4 py-3"
      >
        <p class="text-xs text-zinc-400">LLM Reviews</p>
        <p class="mt-1 text-lg font-medium text-zinc-100">
          {{ config.managedLlmReviewsRemaining }}
          <span class="text-sm text-zinc-500">remaining</span>
        </p>
      </div>
      <div v-if="config.llmSource" class="rounded-lg border border-zinc-800 bg-zinc-950 px-4 py-3">
        <p class="text-xs text-zinc-400">LLM Source</p>
        <p class="mt-1 text-lg font-medium capitalize text-zinc-100">{{ config.llmSource }}</p>
      </div>
    </div>

    <!-- Review Types -->
    <div class="mt-5">
      <p class="text-xs font-medium text-zinc-400">Review Types</p>
      <div class="mt-2 flex flex-wrap gap-2">
        <span
          v-for="rt in reviewTypes"
          :key="rt.key"
          :class="[
            'inline-flex items-center gap-1.5 rounded-full px-3 py-1 text-xs font-medium',
            rt.enabled ? rt.color : 'bg-zinc-800 text-zinc-500',
          ]"
        >
          <span
            :class="[
              'inline-block h-1.5 w-1.5 rounded-full',
              rt.enabled ? 'bg-current' : 'bg-zinc-600',
            ]"
          />
          {{ rt.name }}
          <span v-if="rt.detail && rt.enabled" class="text-[10px] opacity-70">{{ rt.detail }}</span>
        </span>
      </div>
    </div>

    <!-- Features -->
    <div class="mt-5">
      <p class="text-xs font-medium text-zinc-400">Features</p>
      <div class="mt-2 flex flex-wrap gap-2">
        <span
          v-for="feat in features"
          :key="feat.name"
          :class="[
            'inline-flex items-center gap-1.5 rounded-full px-3 py-1 text-xs font-medium',
            feat.enabled ? 'bg-zinc-800 text-zinc-200' : 'bg-zinc-800/50 text-zinc-500',
          ]"
        >
          <svg
            v-if="feat.enabled"
            class="h-3 w-3 text-green-400"
            fill="none"
            viewBox="0 0 24 24"
            stroke="currentColor"
            stroke-width="2"
          >
            <path stroke-linecap="round" stroke-linejoin="round" d="M4.5 12.75l6 6 9-13.5" />
          </svg>
          <svg
            v-else
            class="h-3 w-3 text-zinc-500"
            fill="none"
            viewBox="0 0 24 24"
            stroke="currentColor"
            stroke-width="2"
          >
            <path stroke-linecap="round" stroke-linejoin="round" d="M6 18L18 6M6 6l12 12" />
          </svg>
          {{ feat.name }}
        </span>
      </div>
    </div>

    <!-- Expandable raw JSON -->
    <details class="mt-5">
      <summary class="cursor-pointer text-xs text-zinc-500 transition-colors hover:text-zinc-400">
        View raw configuration
      </summary>
      <pre
        class="mt-2 overflow-auto rounded-lg border border-zinc-800 bg-zinc-950 p-4 font-mono text-[13px] text-zinc-300"
        >{{ JSON.stringify(config, null, 2) }}</pre
      >
    </details>
  </div>
</template>
