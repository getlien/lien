<script setup>
import { computed } from 'vue';
import { Head, Link, useForm } from '@inertiajs/vue3';
import AuthenticatedLayout from '@/Layouts/AuthenticatedLayout.vue';

const props = defineProps({
  organization: Object,
  subscription: Object,
});

const checkoutForm = useForm({});

function startCheckout() {
  checkoutForm.post('/billing/checkout', { preserveScroll: true });
}

const trialDaysLeft = computed(() => {
  if (!props.subscription?.trial_ends_at) {
    return null;
  }
  const ms = new Date(props.subscription.trial_ends_at).getTime() - Date.now();
  return Math.max(0, Math.ceil(ms / 86_400_000));
});

const stateLabel = computed(() => {
  switch (props.subscription?.state) {
    case 'active':
      return 'Active';
    case 'trialing':
      return 'Trial';
    default:
      return 'Inactive';
  }
});

const stateBadge = computed(() => {
  switch (props.subscription?.state) {
    case 'active':
      return 'bg-emerald-500/10 text-emerald-400 ring-emerald-500/20';
    case 'trialing':
      return 'bg-amber-500/10 text-amber-400 ring-amber-500/20';
    default:
      return 'bg-zinc-500/10 text-zinc-400 ring-zinc-500/20';
  }
});

const headline = computed(() => {
  switch (props.subscription?.state) {
    case 'active':
      return 'Lien Review is active for ' + props.organization.name;
    case 'trialing':
      return trialDaysLeft.value === 0
        ? 'Trial ends today'
        : `${trialDaysLeft.value} ${trialDaysLeft.value === 1 ? 'day' : 'days'} left in trial`;
    default:
      return 'Subscribe to keep using Lien Review';
  }
});

const subhead = computed(() => {
  switch (props.subscription?.state) {
    case 'active':
      return 'Manage your subscription, payment method, and invoices in the customer portal.';
    case 'trialing':
      return 'When the trial ends, reviews will pause until you start a subscription.';
    default:
      return 'Reviews are paused. Start a subscription to resume PR reviews on installed repositories.';
  }
});
</script>

<template>
  <Head title="Billing — Lien Review" />

  <AuthenticatedLayout>
    <div class="mx-auto max-w-3xl">
      <div class="flex items-center justify-between">
        <h1 class="text-2xl font-medium text-zinc-100">Billing</h1>
        <span
          class="inline-flex items-center rounded-full px-2.5 py-1 text-xs font-medium ring-1 ring-inset"
          :class="stateBadge"
        >
          {{ stateLabel }}
        </span>
      </div>

      <div class="mt-6 rounded-lg border border-zinc-800 bg-zinc-900 p-6">
        <div class="flex items-start gap-4">
          <img
            v-if="organization.avatar_url"
            :src="organization.avatar_url"
            :alt="organization.name"
            class="h-10 w-10 rounded-md"
          />
          <div class="flex-1">
            <p class="text-sm font-medium text-zinc-400">{{ organization.name }}</p>
            <p class="mt-1 text-lg font-medium text-zinc-100">{{ headline }}</p>
            <p class="mt-1 text-sm text-zinc-400">{{ subhead }}</p>
          </div>
        </div>

        <div class="mt-6 flex flex-wrap items-center gap-3">
          <button
            v-if="subscription.state !== 'active'"
            type="button"
            :disabled="checkoutForm.processing"
            class="inline-flex items-center rounded-md bg-brand-500 px-4 py-2 text-sm font-medium text-white transition-colors hover:bg-brand-600 disabled:opacity-60"
            @click="startCheckout"
          >
            {{ subscription.state === 'trialing' ? 'Subscribe now' : 'Start subscription' }}
          </button>

          <Link
            v-if="subscription.state === 'active'"
            href="/billing/portal"
            class="inline-flex items-center rounded-md bg-brand-500 px-4 py-2 text-sm font-medium text-white transition-colors hover:bg-brand-600"
          >
            Manage subscription
          </Link>

          <Link
            href="/dashboard"
            class="inline-flex items-center rounded-md border border-zinc-700 px-4 py-2 text-sm font-medium text-zinc-300 transition-colors hover:border-zinc-600 hover:text-zinc-100"
          >
            Back to dashboard
          </Link>
        </div>
      </div>

      <div class="mt-6 rounded-lg border border-zinc-800 bg-zinc-900 p-6">
        <h2 class="text-sm font-medium text-zinc-300">What you get</h2>
        <ul class="mt-3 space-y-2 text-sm text-zinc-400">
          <li class="flex items-start gap-2">
            <span
              class="mt-1 inline-block h-1.5 w-1.5 rounded-full bg-brand-400"
              aria-hidden="true"
            />
            AI-powered code review on every PR opened or updated.
          </li>
          <li class="flex items-start gap-2">
            <span
              class="mt-1 inline-block h-1.5 w-1.5 rounded-full bg-brand-400"
              aria-hidden="true"
            />
            Repo enablement is managed in the GitHub App settings — add or remove repos there.
          </li>
          <li class="flex items-start gap-2">
            <span
              class="mt-1 inline-block h-1.5 w-1.5 rounded-full bg-brand-400"
              aria-hidden="true"
            />
            14-day trial with no card required. Subscribe before the trial ends to keep reviews
            running.
          </li>
        </ul>
      </div>
    </div>
  </AuthenticatedLayout>
</template>
