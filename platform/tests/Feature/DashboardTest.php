<?php

namespace Tests\Feature;

use App\Enums\ReviewCommentStatus;
use App\Enums\ReviewRunStatus;
use App\Enums\ReviewRunType;
use App\Models\Organization;
use App\Models\Repository;
use App\Models\ReviewComment;
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
            ->has('repositories', 1)
            ->where('repositories.0.full_name', 'acme/app')
            ->where('range', 30)
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

    public function test_dashboard_defaults_to_30_day_range(): void
    {
        $user = User::factory()->create();
        $org = Organization::factory()->create();
        $user->organizations()->attach($org->id, ['role' => 'admin']);

        $response = $this->actingAs($user)->get('/dashboard');

        $response->assertOk();
        $response->assertInertia(fn ($page) => $page
            ->where('range', 30)
        );
    }

    public function test_dashboard_accepts_valid_range(): void
    {
        $user = User::factory()->create();
        $org = Organization::factory()->create();
        $user->organizations()->attach($org->id, ['role' => 'admin']);

        $response = $this->actingAs($user)->get('/dashboard?range=7');

        $response->assertOk();
        $response->assertInertia(fn ($page) => $page
            ->where('range', 7)
        );
    }

    public function test_dashboard_ignores_invalid_range(): void
    {
        $user = User::factory()->create();
        $org = Organization::factory()->create();
        $user->organizations()->attach($org->id, ['role' => 'admin']);

        $response = $this->actingAs($user)->get('/dashboard?range=15');

        $response->assertOk();
        $response->assertInertia(fn ($page) => $page
            ->where('range', 30)
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

    public function test_impact_stats_are_deferred(): void
    {
        $user = User::factory()->create();
        $org = Organization::factory()->create();
        $user->organizations()->attach($org->id, ['role' => 'admin']);

        $repo = Repository::factory()->create([
            'organization_id' => $org->id,
        ]);

        $run = ReviewRun::factory()->create([
            'repository_id' => $repo->id,
            'type' => ReviewRunType::Pr,
            'pr_number' => 42,
            'status' => ReviewRunStatus::Completed,
            'completed_at' => now(),
        ]);

        ReviewComment::factory()->create([
            'review_run_id' => $run->id,
            'review_type' => 'bugs',
            'status' => ReviewCommentStatus::Posted,
        ]);

        $response = $this->actingAs($user)->get('/dashboard');

        $response->assertOk();
        $response->assertInertia(fn ($page) => $page
            ->missing('impactStats')
            ->loadDeferredProps('stats', fn ($reload) => $reload
                ->has('impactStats', fn ($prop) => $prop
                    ->has('prsReviewed')
                    ->has('findingsPosted')
                    ->has('byType')
                    ->has('resolutionRate')
                    ->has('totalCost')
                )
            )
        );
    }

    public function test_recent_findings_are_deferred(): void
    {
        $user = User::factory()->create();
        $org = Organization::factory()->create();
        $user->organizations()->attach($org->id, ['role' => 'admin']);

        $repo = Repository::factory()->create([
            'organization_id' => $org->id,
        ]);

        $run = ReviewRun::factory()->create([
            'repository_id' => $repo->id,
            'type' => ReviewRunType::Pr,
            'pr_number' => 10,
            'status' => ReviewRunStatus::Completed,
            'completed_at' => now(),
        ]);

        ReviewComment::factory()->create([
            'review_run_id' => $run->id,
            'review_type' => 'bugs',
            'status' => ReviewCommentStatus::Posted,
            'body' => 'Null pointer found',
        ]);

        $response = $this->actingAs($user)->get('/dashboard');

        $response->assertOk();
        $response->assertInertia(fn ($page) => $page
            ->missing('recentFindings')
            ->loadDeferredProps('findings', fn ($reload) => $reload
                ->has('recentFindings', 1)
                ->where('recentFindings.0.review_type', 'bugs')
                ->where('recentFindings.0.body', 'Null pointer found')
            )
        );
    }

    public function test_recent_runs_are_deferred(): void
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

        $response = $this->actingAs($user)->get('/dashboard');

        $response->assertOk();
        $response->assertInertia(fn ($page) => $page
            ->missing('recentRuns')
            ->loadDeferredProps('runs', fn ($reload) => $reload
                ->has('recentRuns', 3)
                ->has('recentRuns.0.id')
                ->has('recentRuns.0.repository_name')
                ->has('recentRuns.0.status')
                ->has('recentRuns.0.created_at')
            )
        );
    }
}
