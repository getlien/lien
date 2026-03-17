<?php

namespace Tests\Feature;

use App\Enums\ReviewRunStatus;
use App\Enums\ReviewRunType;
use App\Models\Organization;
use App\Models\Repository;
use App\Models\ReviewRun;
use App\Models\User;
use Illuminate\Foundation\Testing\RefreshDatabase;
use Tests\TestCase;

class DashboardTest extends TestCase
{
    use RefreshDatabase;

    public function test_guest_is_redirected_to_home(): void
    {
        $response = $this->get('/dashboard');

        $response->assertRedirect('/');
    }

    public function test_authenticated_user_sees_dashboard(): void
    {
        $user = User::factory()->create();
        $org = Organization::factory()->create();
        $user->organizations()->attach($org->id, ['role' => 'admin']);

        $repo = Repository::factory()->create([
            'organization_id' => $org->id,
            'full_name' => 'acme/app',
        ]);

        ReviewRun::factory()->create([
            'repository_id' => $repo->id,
            'status' => ReviewRunStatus::Completed,
            'completed_at' => now(),
        ]);

        $response = $this->actingAs($user)->get('/dashboard');

        $response->assertOk();
        $response->assertInertia(fn ($page) => $page
            ->component('Dashboard')
            ->where('view', 'by_pr')
            ->has('repositories', 1)
            ->where('repositories.0.full_name', 'acme/app')
            ->has('filters')
            ->where('filters.type', null)
            ->where('filters.status', null)
            ->where('filters.repo', null)
        );
    }

    public function test_only_active_repositories_appear(): void
    {
        $user = User::factory()->create();
        $org = Organization::factory()->create();
        $user->organizations()->attach($org->id, ['role' => 'admin']);

        Repository::factory()->create([
            'organization_id' => $org->id,
            'full_name' => 'acme/active-repo',
            'is_active' => true,
        ]);

        Repository::factory()->inactive()->create([
            'organization_id' => $org->id,
            'full_name' => 'acme/inactive-repo',
        ]);

        $response = $this->actingAs($user)->get('/dashboard');

        $response->assertOk();
        $response->assertInertia(fn ($page) => $page
            ->has('repositories', 1)
            ->where('repositories.0.full_name', 'acme/active-repo')
        );
    }

    public function test_user_with_no_organizations_sees_empty_list(): void
    {
        $user = User::factory()->create();

        $response = $this->actingAs($user)->get('/dashboard');

        $response->assertOk();
        $response->assertInertia(fn ($page) => $page
            ->component('Dashboard')
            ->has('repositories', 0)
        );
    }

    public function test_sidebar_includes_org_repo_structure_with_only_active_repos(): void
    {
        $user = User::factory()->create();
        $org = Organization::factory()->create();
        $user->organizations()->attach($org->id, ['role' => 'admin']);

        Repository::factory()->create([
            'organization_id' => $org->id,
            'full_name' => 'acme/active-repo',
            'is_active' => true,
        ]);

        Repository::factory()->inactive()->create([
            'organization_id' => $org->id,
            'full_name' => 'acme/inactive-repo',
        ]);

        $response = $this->actingAs($user)->get('/dashboard');

        $response->assertOk();
        $response->assertInertia(fn ($page) => $page
            ->has('sidebar', 1)
            ->where('sidebar.0.name', $org->name)
            ->where('sidebar.0.slug', $org->slug)
            ->has('sidebar.0.avatar_url')
            ->has('sidebar.0.repositories', 1)
            ->where('sidebar.0.repositories.0.full_name', 'acme/active-repo')
        );
    }

    public function test_dashboard_defaults_to_by_pr_view(): void
    {
        $user = User::factory()->create();
        $org = Organization::factory()->create();
        $user->organizations()->attach($org->id, ['role' => 'admin']);

        $response = $this->actingAs($user)->get('/dashboard');

        $response->assertOk();
        $response->assertInertia(fn ($page) => $page
            ->where('view', 'by_pr')
        );
    }

    public function test_dashboard_accepts_all_view(): void
    {
        $user = User::factory()->create();
        $org = Organization::factory()->create();
        $user->organizations()->attach($org->id, ['role' => 'admin']);

        $response = $this->actingAs($user)->get('/dashboard?view=all');

        $response->assertOk();
        $response->assertInertia(fn ($page) => $page
            ->where('view', 'all')
        );
    }

    public function test_dashboard_ignores_invalid_view(): void
    {
        $user = User::factory()->create();
        $org = Organization::factory()->create();
        $user->organizations()->attach($org->id, ['role' => 'admin']);

        $response = $this->actingAs($user)->get('/dashboard?view=invalid');

        $response->assertOk();
        $response->assertInertia(fn ($page) => $page
            ->where('view', 'by_pr')
        );
    }

    public function test_dashboard_filters_by_status(): void
    {
        $user = User::factory()->create();
        $org = Organization::factory()->create();
        $user->organizations()->attach($org->id, ['role' => 'admin']);

        $response = $this->actingAs($user)->get('/dashboard?status=completed');

        $response->assertOk();
        $response->assertInertia(fn ($page) => $page
            ->where('filters.status', 'completed')
        );
    }

    public function test_dashboard_filters_by_type_in_all_view(): void
    {
        $user = User::factory()->create();
        $org = Organization::factory()->create();
        $user->organizations()->attach($org->id, ['role' => 'admin']);

        $response = $this->actingAs($user)->get('/dashboard?view=all&type=baseline');

        $response->assertOk();
        $response->assertInertia(fn ($page) => $page
            ->where('view', 'all')
            ->where('filters.type', 'baseline')
        );
    }

    public function test_dashboard_filters_by_repository(): void
    {
        $user = User::factory()->create();
        $org = Organization::factory()->create();
        $user->organizations()->attach($org->id, ['role' => 'admin']);

        $repo = Repository::factory()->create([
            'organization_id' => $org->id,
        ]);

        $response = $this->actingAs($user)->get('/dashboard?repo='.$repo->id);

        $response->assertOk();
        $response->assertInertia(fn ($page) => $page
            ->where('filters.repo', $repo->id)
        );
    }

    public function test_dashboard_ignores_invalid_repo_filter(): void
    {
        $user = User::factory()->create();
        $org = Organization::factory()->create();
        $user->organizations()->attach($org->id, ['role' => 'admin']);

        $response = $this->actingAs($user)->get('/dashboard?repo=99999');

        $response->assertOk();
        $response->assertInertia(fn ($page) => $page
            ->where('filters.repo', null)
        );
    }

    public function test_dashboard_repositories_prop_only_includes_active_repos(): void
    {
        $user = User::factory()->create();
        $org = Organization::factory()->create();
        $user->organizations()->attach($org->id, ['role' => 'admin']);

        Repository::factory()->create([
            'organization_id' => $org->id,
            'full_name' => 'acme/active',
            'is_active' => true,
        ]);

        Repository::factory()->inactive()->create([
            'organization_id' => $org->id,
            'full_name' => 'acme/inactive',
        ]);

        $response = $this->actingAs($user)->get('/dashboard');

        $response->assertOk();
        $response->assertInertia(fn ($page) => $page
            ->has('repositories', 1)
            ->where('repositories.0.full_name', 'acme/active')
        );
    }

    public function test_grouped_view_returns_baseline_and_pr_groups(): void
    {
        $user = User::factory()->create();
        $org = Organization::factory()->create();
        $user->organizations()->attach($org->id, ['role' => 'admin']);

        $repo = Repository::factory()->create([
            'organization_id' => $org->id,
        ]);

        ReviewRun::factory()->baseline()->create([
            'repository_id' => $repo->id,
            'status' => ReviewRunStatus::Completed,
            'completed_at' => now(),
        ]);

        ReviewRun::factory()->create([
            'repository_id' => $repo->id,
            'type' => ReviewRunType::Pr,
            'pr_number' => 42,
            'status' => ReviewRunStatus::Completed,
            'completed_at' => now(),
        ]);

        $response = $this->actingAs($user)->get('/dashboard');

        $response->assertOk();
        $response->assertInertia(fn ($page) => $page
            ->where('view', 'by_pr')
            ->missing('groupedRuns')
            ->loadDeferredProps('runs', fn ($reload) => $reload
                ->has('groupedRuns', fn ($prop) => $prop
                    ->has('data', 2)
                    ->has('data.0.repository_id')
                    ->has('data.0.type')
                    ->has('data.0.latest_status')
                    ->has('data.0.runs_count')
                    ->has('data.0.latest_run_id')
                    ->has('data.0.trend_data')
                    ->etc()
                )
            )
        );
    }

    public function test_all_runs_view_returns_paginated_runs(): void
    {
        $user = User::factory()->create();
        $org = Organization::factory()->create();
        $user->organizations()->attach($org->id, ['role' => 'admin']);

        $repo = Repository::factory()->create([
            'organization_id' => $org->id,
        ]);

        ReviewRun::factory()->count(3)->create([
            'repository_id' => $repo->id,
            'status' => ReviewRunStatus::Completed,
            'completed_at' => now(),
        ]);

        $response = $this->actingAs($user)->get('/dashboard?view=all');

        $response->assertOk();
        $response->assertInertia(fn ($page) => $page
            ->where('view', 'all')
            ->missing('allRuns')
            ->loadDeferredProps('runs', fn ($reload) => $reload
                ->has('allRuns', fn ($prop) => $prop
                    ->has('data', 3)
                    ->has('data.0.id')
                    ->has('data.0.repository_name')
                    ->has('data.0.type')
                    ->has('data.0.status')
                    ->has('data.0.created_at')
                    ->etc()
                )
            )
        );
    }

    public function test_all_runs_view_filters_by_type(): void
    {
        $user = User::factory()->create();
        $org = Organization::factory()->create();
        $user->organizations()->attach($org->id, ['role' => 'admin']);

        $repo = Repository::factory()->create([
            'organization_id' => $org->id,
        ]);

        ReviewRun::factory()->baseline()->create([
            'repository_id' => $repo->id,
            'status' => ReviewRunStatus::Completed,
            'completed_at' => now(),
        ]);

        ReviewRun::factory()->create([
            'repository_id' => $repo->id,
            'type' => ReviewRunType::Pr,
            'pr_number' => 10,
            'status' => ReviewRunStatus::Completed,
            'completed_at' => now(),
        ]);

        $response = $this->actingAs($user)->get('/dashboard?view=all&type=baseline');

        $response->assertOk();
        $response->assertInertia(fn ($page) => $page
            ->loadDeferredProps('runs', fn ($reload) => $reload
                ->has('allRuns', fn ($prop) => $prop
                    ->has('data', 1)
                    ->where('data.0.type', 'baseline')
                    ->etc()
                )
            )
        );
    }

    public function test_grouped_view_filters_by_status(): void
    {
        $user = User::factory()->create();
        $org = Organization::factory()->create();
        $user->organizations()->attach($org->id, ['role' => 'admin']);

        $repo = Repository::factory()->create([
            'organization_id' => $org->id,
        ]);

        ReviewRun::factory()->create([
            'repository_id' => $repo->id,
            'type' => ReviewRunType::Pr,
            'pr_number' => 1,
            'status' => ReviewRunStatus::Completed,
            'completed_at' => now(),
        ]);

        ReviewRun::factory()->create([
            'repository_id' => $repo->id,
            'type' => ReviewRunType::Pr,
            'pr_number' => 2,
            'status' => ReviewRunStatus::Failed,
        ]);

        $response = $this->actingAs($user)->get('/dashboard?status=completed');

        $response->assertOk();
        $response->assertInertia(fn ($page) => $page
            ->loadDeferredProps('runs', fn ($reload) => $reload
                ->has('groupedRuns', fn ($prop) => $prop
                    ->has('data', 1)
                    ->where('data.0.latest_status', 'completed')
                    ->etc()
                )
            )
        );
    }
}
