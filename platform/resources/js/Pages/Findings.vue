<script setup>
import { ref } from 'vue';
import { Deferred, Head, router } from '@inertiajs/vue3';
import AuthenticatedLayout from '@/Layouts/AuthenticatedLayout.vue';
import FindingsSummaryBar from '@/Components/Findings/FindingsSummaryBar.vue';
import FindingsFilters from '@/Components/Findings/FindingsFilters.vue';
import FindingsTable from '@/Components/Findings/FindingsTable.vue';
import FindingDetailSidebar from '@/Components/Findings/FindingDetailSidebar.vue';
import SkeletonStatGrid from '@/Components/Skeletons/SkeletonStatGrid.vue';
import SkeletonTable from '@/Components/Skeletons/SkeletonTable.vue';

const selectedFinding = ref(null);

const props = defineProps({
  repositories: Array,
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
  router.get('/findings', params, { preserveState: true });
}
</script>

<template>
  <Head title="Findings — Lien Review" />
  <AuthenticatedLayout>
    <div>
      <h1 class="text-2xl font-medium text-zinc-100">Findings</h1>

      <Deferred :data="['summary']">
        <template #fallback>
          <SkeletonStatGrid class="mt-6" :columns="4" />
        </template>
        <FindingsSummaryBar v-if="summary" :summary="summary" class="mt-6 deferred-enter" />
      </Deferred>

      <FindingsFilters
        :filters="filters"
        :repositories="repositories"
        class="mt-6"
        @filter="applyFilter"
      />

      <Deferred :data="['findings']">
        <template #fallback>
          <SkeletonTable class="mt-6" />
        </template>
        <FindingsTable
          v-if="findings"
          :findings="findings"
          class="mt-6 deferred-enter"
          @select="selectedFinding = $event"
        />
      </Deferred>
    </div>
    <FindingDetailSidebar :finding="selectedFinding" @close="selectedFinding = null" />
  </AuthenticatedLayout>
</template>
