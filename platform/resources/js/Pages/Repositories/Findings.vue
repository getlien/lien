<script setup>
import { Deferred, Head, router } from '@inertiajs/vue3';
import AuthenticatedLayout from '@/Layouts/AuthenticatedLayout.vue';
import Breadcrumbs from '@/Components/Breadcrumbs.vue';
import FindingsSummaryBar from '@/Components/Findings/FindingsSummaryBar.vue';
import FindingsFilters from '@/Components/Findings/FindingsFilters.vue';
import FindingsTable from '@/Components/Findings/FindingsTable.vue';
import SkeletonStatGrid from '@/Components/Skeletons/SkeletonStatGrid.vue';
import SkeletonTable from '@/Components/Skeletons/SkeletonTable.vue';

const props = defineProps({
  repository: Object,
  organization: Object,
  filters: Object,
  summary: Object,
  findings: Object,
});

function applyFilter(key, value) {
  const params = { ...props.filters };
  if (value) {
    params[key] = value;
  } else {
    delete params[key];
  }
  delete params.page;
  router.get(`/repos/${props.repository.id}/findings`, params, { preserveState: true });
}
</script>

<template>
  <Head :title="`Findings — ${repository.full_name} — Lien Review`" />
  <AuthenticatedLayout>
    <div>
      <Breadcrumbs
        :items="[
          { label: 'Dashboard', href: '/dashboard' },
          { label: repository.full_name, href: `/repos/${repository.id}/dashboard` },
          { label: 'Findings' },
        ]"
        class="mb-4"
      />
      <h1 class="text-2xl font-medium text-zinc-100">Findings</h1>
      <p class="mt-1 text-sm text-zinc-400">{{ repository.full_name }}</p>

      <Deferred :data="['summary']">
        <template #fallback>
          <SkeletonStatGrid class="mt-6" :columns="4" />
        </template>
        <FindingsSummaryBar v-if="summary" :summary="summary" class="mt-6 deferred-enter" />
      </Deferred>

      <FindingsFilters
        :filters="filters"
        :show-repo-filter="false"
        class="mt-6"
        @filter="applyFilter"
      />

      <Deferred :data="['findings']">
        <template #fallback>
          <SkeletonTable class="mt-6" />
        </template>
        <FindingsTable v-if="findings" :findings="findings" class="mt-6 deferred-enter" />
      </Deferred>
    </div>
  </AuthenticatedLayout>
</template>
