<script setup>
import { computed } from 'vue';
import { usePage, Link } from '@inertiajs/vue3';
import LienLogo from '@/Components/LienLogo.vue';
import Toast from '@/Components/Toast.vue';
import CommandPalette from '@/Components/CommandPalette.vue';
import { useSidebar } from '@/composables/useSidebar';

const page = usePage();
const user = computed(() => page.props.auth.user);
const sidebar = computed(() => page.props.sidebar ?? []);
const currentUrl = computed(() => page.url);

const { isCollapsed, isMobileOpen, toggle, openMobile, closeMobile } = useSidebar();

const repoMatch = computed(() => {
  const match = currentUrl.value.match(/^\/repos\/(\d+)/);
  return match ? Number(match[1]) : null;
});

function isRepoActive(repoId) {
  return repoMatch.value === repoId;
}

function isSubNav(path) {
  return currentUrl.value.startsWith(path);
}
</script>

<template>
  <div class="flex min-h-screen bg-zinc-950">
    <!-- Mobile backdrop -->
    <Transition
      enter-active-class="transition-opacity duration-200 ease-out"
      enter-from-class="opacity-0"
      leave-active-class="transition-opacity duration-150 ease-in"
      leave-to-class="opacity-0"
    >
      <div
        v-if="isMobileOpen"
        class="fixed inset-0 z-40 bg-black/60 lg:hidden"
        @click="closeMobile"
      />
    </Transition>

    <!-- Sidebar -->
    <aside
      :class="[
        'fixed inset-y-0 left-0 z-50 flex flex-col border-r border-zinc-800 bg-zinc-900 transition-all duration-200',
        isCollapsed ? 'w-16' : 'w-64',
        isMobileOpen ? 'translate-x-0' : '-translate-x-full lg:translate-x-0',
      ]"
      aria-label="Sidebar navigation"
    >
      <!-- Logo + collapse toggle -->
      <div class="flex h-14 items-center justify-between border-b border-zinc-800 px-4">
        <Link href="/dashboard" aria-label="Lien Review home">
          <LienLogo size="sm" :show-text="false" />
        </Link>
        <button
          v-if="!isCollapsed"
          type="button"
          class="hidden rounded-md p-1 text-zinc-500 transition-colors hover:bg-zinc-800 hover:text-zinc-300 lg:block"
          aria-label="Collapse sidebar"
          @click="toggle"
        >
          <svg
            class="h-4 w-4"
            fill="none"
            viewBox="0 0 24 24"
            stroke="currentColor"
            stroke-width="1.5"
          >
            <path
              stroke-linecap="round"
              stroke-linejoin="round"
              d="M11 19l-7-7 7-7m8 14l-7-7 7-7"
            />
          </svg>
        </button>
        <button
          v-if="isCollapsed"
          type="button"
          class="hidden rounded-md p-1 text-zinc-500 transition-colors hover:bg-zinc-800 hover:text-zinc-300 lg:block"
          aria-label="Expand sidebar"
          @click="toggle"
        >
          <svg
            class="h-4 w-4"
            fill="none"
            viewBox="0 0 24 24"
            stroke="currentColor"
            stroke-width="1.5"
          >
            <path stroke-linecap="round" stroke-linejoin="round" d="M13 5l7 7-7 7M5 5l7 7-7 7" />
          </svg>
        </button>
      </div>

      <!-- Nav content -->
      <nav class="flex-1 overflow-y-auto px-3 py-4">
        <!-- Dashboard link -->
        <Link
          href="/dashboard"
          :class="[
            'flex items-center gap-3 rounded-md px-3 py-2 text-sm font-medium transition-colors',
            currentUrl === '/dashboard'
              ? 'bg-zinc-800 text-brand-400'
              : 'text-zinc-400 hover:bg-zinc-800/50 hover:text-zinc-200',
          ]"
          :aria-current="currentUrl === '/dashboard' ? 'page' : undefined"
        >
          <svg
            class="h-5 w-5 shrink-0"
            fill="none"
            viewBox="0 0 24 24"
            stroke="currentColor"
            stroke-width="1.5"
          >
            <path
              stroke-linecap="round"
              stroke-linejoin="round"
              d="M3.75 6A2.25 2.25 0 016 3.75h2.25A2.25 2.25 0 0110.5 6v2.25a2.25 2.25 0 01-2.25 2.25H6a2.25 2.25 0 01-2.25-2.25V6zM3.75 15.75A2.25 2.25 0 016 13.5h2.25a2.25 2.25 0 012.25 2.25V18a2.25 2.25 0 01-2.25 2.25H6A2.25 2.25 0 013.75 18v-2.25zM13.5 6a2.25 2.25 0 012.25-2.25H18A2.25 2.25 0 0120.25 6v2.25A2.25 2.25 0 0118 10.5h-2.25a2.25 2.25 0 01-2.25-2.25V6zM13.5 15.75a2.25 2.25 0 012.25-2.25H18a2.25 2.25 0 012.25 2.25V18A2.25 2.25 0 0118 20.25h-2.25A2.25 2.25 0 0113.5 18v-2.25z"
            />
          </svg>
          <span v-if="!isCollapsed">Dashboard</span>
        </Link>

        <!-- Findings link -->
        <Link
          href="/findings"
          :class="[
            'flex items-center gap-3 rounded-md px-3 py-2 text-sm font-medium transition-colors',
            currentUrl.startsWith('/findings')
              ? 'bg-zinc-800 text-brand-400'
              : 'text-zinc-400 hover:bg-zinc-800/50 hover:text-zinc-200',
          ]"
          :aria-current="currentUrl.startsWith('/findings') ? 'page' : undefined"
        >
          <svg
            class="h-5 w-5 shrink-0"
            fill="none"
            viewBox="0 0 24 24"
            stroke="currentColor"
            stroke-width="1.5"
          >
            <path
              stroke-linecap="round"
              stroke-linejoin="round"
              d="M2.036 12.322a1.012 1.012 0 010-.639C3.423 7.51 7.36 4.5 12 4.5c4.638 0 8.573 3.007 9.963 7.178.07.207.07.431 0 .639C20.577 16.49 16.64 19.5 12 19.5c-4.638 0-8.573-3.007-9.963-7.178z"
            />
            <path
              stroke-linecap="round"
              stroke-linejoin="round"
              d="M15 12a3 3 0 11-6 0 3 3 0 016 0z"
            />
          </svg>
          <span v-if="!isCollapsed">Findings</span>
        </Link>

        <!-- Org/Repo tree -->
        <div v-if="sidebar.length && !isCollapsed" class="mt-6 space-y-4">
          <div v-for="org in sidebar" :key="org.id">
            <div class="flex items-center gap-2 px-3 py-1">
              <img
                v-if="org.avatar_url"
                :src="org.avatar_url"
                :alt="org.name"
                class="h-4 w-4 rounded-full"
              />
              <span class="truncate text-xs font-medium tracking-wide text-zinc-400">
                {{ org.name }}
              </span>
            </div>
            <div class="mt-1 space-y-0.5">
              <Link
                v-for="repo in org.repositories"
                :key="repo.id"
                :href="`/repos/${repo.id}/dashboard`"
                :class="[
                  'block truncate rounded-md px-3 py-1.5 pl-9 text-sm transition-colors',
                  isRepoActive(repo.id)
                    ? 'bg-zinc-800 text-brand-400'
                    : 'text-zinc-400 hover:bg-zinc-800/50 hover:text-zinc-200',
                ]"
                :aria-current="isRepoActive(repo.id) ? 'page' : undefined"
              >
                {{ repo.full_name.split('/').pop() }}
              </Link>
            </div>
          </div>
        </div>

        <!-- Collapsed: just icons for orgs -->
        <div v-if="sidebar.length && isCollapsed" class="mt-6 space-y-2">
          <Link
            v-for="org in sidebar"
            :key="org.id"
            :href="
              org.repositories.length ? `/repos/${org.repositories[0].id}/dashboard` : '/dashboard'
            "
            class="flex justify-center rounded-md p-2 transition-colors hover:bg-zinc-800/50"
            :title="org.name"
          >
            <img
              v-if="org.avatar_url"
              :src="org.avatar_url"
              :alt="org.name"
              class="h-6 w-6 rounded-full"
            />
          </Link>
        </div>
      </nav>

      <!-- Keyboard shortcut hint -->
      <div v-if="!isCollapsed" class="border-t border-zinc-800 px-4 py-2">
        <button
          type="button"
          class="flex w-full items-center gap-2 rounded-md bg-zinc-800/50 px-3 py-1.5 text-xs text-zinc-500 transition-colors hover:text-zinc-400"
          @click="$refs.commandPalette?.open()"
        >
          <svg
            class="h-3.5 w-3.5"
            fill="none"
            viewBox="0 0 24 24"
            stroke="currentColor"
            stroke-width="1.5"
          >
            <path
              stroke-linecap="round"
              stroke-linejoin="round"
              d="M21 21l-5.197-5.197m0 0A7.5 7.5 0 105.196 5.196a7.5 7.5 0 0010.607 10.607z"
            />
          </svg>
          <span>Search...</span>
          <kbd
            class="ml-auto rounded border border-zinc-700 px-1.5 py-0.5 font-mono text-[10px] text-zinc-500"
            >⌘K</kbd
          >
        </button>
      </div>

      <!-- User section -->
      <div class="border-t border-zinc-800 p-3">
        <div :class="['flex items-center', isCollapsed ? 'justify-center' : 'gap-3']">
          <img
            v-if="user?.avatar_url"
            :src="user.avatar_url"
            :alt="`${user.name}'s avatar`"
            class="h-7 w-7 shrink-0 rounded-full"
          />
          <div v-if="!isCollapsed" class="min-w-0 flex-1">
            <p class="truncate text-sm font-medium text-zinc-200">{{ user?.name }}</p>
          </div>
          <Link
            v-if="!isCollapsed"
            href="/auth/logout"
            method="post"
            as="button"
            class="shrink-0 rounded-md p-1.5 text-zinc-500 transition-colors hover:bg-zinc-800 hover:text-zinc-300"
            aria-label="Log out of your account"
          >
            <svg
              class="h-4 w-4"
              fill="none"
              viewBox="0 0 24 24"
              stroke="currentColor"
              stroke-width="1.5"
            >
              <path
                stroke-linecap="round"
                stroke-linejoin="round"
                d="M15.75 9V5.25A2.25 2.25 0 0013.5 3h-6a2.25 2.25 0 00-2.25 2.25v13.5A2.25 2.25 0 007.5 21h6a2.25 2.25 0 002.25-2.25V15m3 0l3-3m0 0l-3-3m3 3H9"
              />
            </svg>
          </Link>
        </div>
      </div>
    </aside>

    <!-- Main area -->
    <div
      :class="[
        'flex min-h-screen min-w-0 flex-1 flex-col transition-all duration-200',
        isCollapsed ? 'lg:pl-16' : 'lg:pl-64',
      ]"
    >
      <!-- Mobile top bar -->
      <div
        class="sticky top-0 z-30 flex h-14 items-center gap-4 border-b border-zinc-800 bg-zinc-950/80 px-4 backdrop-blur lg:hidden"
      >
        <button
          type="button"
          class="rounded-md p-2 text-zinc-400 hover:bg-zinc-800 hover:text-zinc-200"
          aria-label="Open navigation"
          @click="openMobile"
        >
          <svg
            class="h-5 w-5"
            fill="none"
            viewBox="0 0 24 24"
            stroke="currentColor"
            stroke-width="1.5"
          >
            <path
              stroke-linecap="round"
              stroke-linejoin="round"
              d="M3.75 6.75h16.5M3.75 12h16.5m-16.5 5.25h16.5"
            />
          </svg>
        </button>
        <Link href="/dashboard" aria-label="Lien Review home">
          <LienLogo size="sm" :show-text="false" />
        </Link>
      </div>

      <!-- Repo sub-nav tabs -->
      <div v-if="repoMatch" class="border-b border-zinc-800 bg-zinc-950">
        <div class="mx-auto flex max-w-6xl gap-1 px-4 sm:px-6 lg:px-8">
          <Link
            :href="`/repos/${repoMatch}/dashboard`"
            :class="[
              'border-b-2 px-4 py-3 text-sm font-medium transition-colors',
              isSubNav(`/repos/${repoMatch}/dashboard`)
                ? 'border-brand-500 text-brand-400'
                : 'border-transparent text-zinc-400 hover:border-zinc-700 hover:text-zinc-200',
            ]"
          >
            Dashboard
          </Link>
          <Link
            :href="`/repos/${repoMatch}/findings`"
            :class="[
              'border-b-2 px-4 py-3 text-sm font-medium transition-colors',
              isSubNav(`/repos/${repoMatch}/findings`)
                ? 'border-brand-500 text-brand-400'
                : 'border-transparent text-zinc-400 hover:border-zinc-700 hover:text-zinc-200',
            ]"
          >
            Findings
          </Link>
          <Link
            :href="`/repos/${repoMatch}/runs`"
            :class="[
              'border-b-2 px-4 py-3 text-sm font-medium transition-colors',
              isSubNav(`/repos/${repoMatch}/runs`)
                ? 'border-brand-500 text-brand-400'
                : 'border-transparent text-zinc-400 hover:border-zinc-700 hover:text-zinc-200',
            ]"
          >
            Runs
          </Link>
          <Link
            :href="`/repos/${repoMatch}/config`"
            :class="[
              'border-b-2 px-4 py-3 text-sm font-medium transition-colors',
              isSubNav(`/repos/${repoMatch}/config`)
                ? 'border-brand-500 text-brand-400'
                : 'border-transparent text-zinc-400 hover:border-zinc-700 hover:text-zinc-200',
            ]"
          >
            Config
          </Link>
        </div>
      </div>

      <!-- Page content -->
      <main class="mx-auto w-full max-w-6xl flex-1 px-4 py-8 sm:px-6 lg:px-8">
        <slot />
      </main>
    </div>

    <Toast />
    <CommandPalette ref="commandPalette" />
  </div>
</template>
