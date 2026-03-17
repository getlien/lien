<?php

namespace Tests\Feature;

use App\Enums\ReviewRunStatus;
use App\Models\ComplexitySnapshot;
use App\Models\Organization;
use App\Models\Repository;
use App\Models\ReviewComment;
use App\Models\ReviewRun;
use App\Models\User;
use Illuminate\Foundation\Testing\RefreshDatabase;
use Tests\TestCase;

class RepositoryDashboardTest extends TestCase
{
    use RefreshDatabase;

    public function test_show_dashboard_page(): void
    {
        $user = User::factory()->create();
        $org = Organization::factory()->create();
        $user->organizations()->attach($org->id, ['role' => 'admin']);
        $repo = Repository::factory()->create(['organization_id' => $org->id]);

        $response = $this->actingAs($user)->get("/repos/{$repo->id}/dashboard");

        $response->assertOk();
        $response->assertInertia(fn ($page) => $page
            ->component('Repositories/Dashboard')
            ->has('repository')
            ->has('organization')
            ->has('totalRuns')
        );
    }

    public function test_show_dashboard_with_review_data(): void
    {
        $user = User::factory()->create();
        $org = Organization::factory()->create();
        $user->organizations()->attach($org->id, ['role' => 'admin']);
        $repo = Repository::factory()->create(['organization_id' => $org->id]);

        $run = ReviewRun::factory()->create([
            'repository_id' => $repo->id,
            'status' => ReviewRunStatus::Completed,
        ]);

        ComplexitySnapshot::factory()->count(3)->create([
            'review_run_id' => $run->id,
            'repository_id' => $repo->id,
        ]);

        ReviewComment::factory()->count(2)->create([
            'review_run_id' => $run->id,
        ]);

        $response = $this->actingAs($user)->get("/repos/{$repo->id}/dashboard");

        $response->assertOk();
        $response->assertInertia(fn ($page) => $page
            ->component('Repositories/Dashboard')
            ->where('totalRuns', 1)
            ->whereNot('lastReviewDate', null)
        );
    }

    public function test_dashboard_with_multiple_runs(): void
    {
        $user = User::factory()->create();
        $org = Organization::factory()->create();
        $user->organizations()->attach($org->id, ['role' => 'admin']);
        $repo = Repository::factory()->create(['organization_id' => $org->id]);

        ReviewRun::factory()->count(5)->create([
            'repository_id' => $repo->id,
            'status' => ReviewRunStatus::Completed,
        ]);

        $response = $this->actingAs($user)->get("/repos/{$repo->id}/dashboard");

        $response->assertOk();
        $response->assertInertia(fn ($page) => $page
            ->component('Repositories/Dashboard')
            ->where('totalRuns', 5)
        );
    }

    public function test_dashboard_empty_state(): void
    {
        $user = User::factory()->create();
        $org = Organization::factory()->create();
        $user->organizations()->attach($org->id, ['role' => 'admin']);
        $repo = Repository::factory()->create(['organization_id' => $org->id]);

        $response = $this->actingAs($user)->get("/repos/{$repo->id}/dashboard");

        $response->assertOk();
        $response->assertInertia(fn ($page) => $page
            ->component('Repositories/Dashboard')
            ->where('totalRuns', 0)
            ->where('lastReviewDate', null)
        );
    }

    public function test_dashboard_includes_baseline_progress(): void
    {
        $user = User::factory()->create();
        $org = Organization::factory()->create();
        $user->organizations()->attach($org->id, ['role' => 'admin']);
        $repo = Repository::factory()->create(['organization_id' => $org->id]);

        ReviewRun::factory()->baseline()->pending()->count(3)->create([
            'repository_id' => $repo->id,
        ]);

        ReviewRun::factory()->baseline()->create([
            'repository_id' => $repo->id,
            'status' => ReviewRunStatus::Completed,
        ]);

        $response = $this->actingAs($user)->get("/repos/{$repo->id}/dashboard");

        $response->assertOk();
        $response->assertInertia(fn ($page) => $page
            ->has('baselineProgress')
            ->where('baselineProgress.pending', 3)
            ->where('baselineProgress.completed', 1)
            ->where('baselineProgress.total', 4)
            ->where('baselineProgress.is_generating', true)
        );
    }

    public function test_baseline_progress_not_generating_when_all_complete(): void
    {
        $user = User::factory()->create();
        $org = Organization::factory()->create();
        $user->organizations()->attach($org->id, ['role' => 'admin']);
        $repo = Repository::factory()->create(['organization_id' => $org->id]);

        ReviewRun::factory()->baseline()->count(2)->create([
            'repository_id' => $repo->id,
            'status' => ReviewRunStatus::Completed,
        ]);

        $response = $this->actingAs($user)->get("/repos/{$repo->id}/dashboard");

        $response->assertOk();
        $response->assertInertia(fn ($page) => $page
            ->where('baselineProgress.pending', 0)
            ->where('baselineProgress.completed', 2)
            ->where('baselineProgress.total', 2)
            ->where('baselineProgress.is_generating', false)
        );
    }

    public function test_non_member_cannot_access_dashboard(): void
    {
        $user = User::factory()->create();
        $repo = Repository::factory()->create();

        $response = $this->actingAs($user)->get("/repos/{$repo->id}/dashboard");

        $response->assertForbidden();
    }

    public function test_guest_cannot_access_dashboard(): void
    {
        $repo = Repository::factory()->create();

        $response = $this->get("/repos/{$repo->id}/dashboard");

        $response->assertRedirect('/');
    }

    public function test_dashboard_includes_recent_runs_deferred_prop(): void
    {
        $user = User::factory()->create();
        $org = Organization::factory()->create();
        $user->organizations()->attach($org->id, ['role' => 'admin']);
        $repo = Repository::factory()->create(['organization_id' => $org->id]);

        ReviewRun::factory()->count(3)->create([
            'repository_id' => $repo->id,
            'status' => ReviewRunStatus::Completed,
        ]);

        ReviewRun::factory()->pending()->create([
            'repository_id' => $repo->id,
        ]);

        $response = $this->actingAs($user)->get("/repos/{$repo->id}/dashboard");

        $response->assertOk();
        $response->assertInertia(fn ($page) => $page
            ->component('Repositories/Dashboard')
        );
    }

    public function test_dashboard_accepts_range_query_param(): void
    {
        $user = User::factory()->create();
        $org = Organization::factory()->create();
        $user->organizations()->attach($org->id, ['role' => 'admin']);
        $repo = Repository::factory()->create(['organization_id' => $org->id]);

        $response = $this->actingAs($user)->get("/repos/{$repo->id}/dashboard?range=7");

        $response->assertOk();
        $response->assertInertia(fn ($page) => $page
            ->component('Repositories/Dashboard')
            ->where('range', 7)
        );
    }

    public function test_dashboard_defaults_range_to_30(): void
    {
        $user = User::factory()->create();
        $org = Organization::factory()->create();
        $user->organizations()->attach($org->id, ['role' => 'admin']);
        $repo = Repository::factory()->create(['organization_id' => $org->id]);

        $response = $this->actingAs($user)->get("/repos/{$repo->id}/dashboard");

        $response->assertOk();
        $response->assertInertia(fn ($page) => $page
            ->component('Repositories/Dashboard')
            ->where('range', 30)
        );
    }

    public function test_dashboard_clamps_invalid_range_to_30(): void
    {
        $user = User::factory()->create();
        $org = Organization::factory()->create();
        $user->organizations()->attach($org->id, ['role' => 'admin']);
        $repo = Repository::factory()->create(['organization_id' => $org->id]);

        $response = $this->actingAs($user)->get("/repos/{$repo->id}/dashboard?range=999");

        $response->assertOk();
        $response->assertInertia(fn ($page) => $page
            ->component('Repositories/Dashboard')
            ->where('range', 30)
        );
    }

    public function test_dashboard_with_trend_data(): void
    {
        $user = User::factory()->create();
        $org = Organization::factory()->create();
        $user->organizations()->attach($org->id, ['role' => 'admin']);
        $repo = Repository::factory()->create(['organization_id' => $org->id]);

        $run1 = ReviewRun::factory()->create([
            'repository_id' => $repo->id,
            'status' => ReviewRunStatus::Completed,
            'completed_at' => now()->subDay(),
        ]);

        ComplexitySnapshot::factory()->create([
            'review_run_id' => $run1->id,
            'repository_id' => $repo->id,
            'filepath' => 'src/auth.ts',
            'symbol_name' => 'login',
            'cyclomatic' => 10,
            'cognitive' => 12,
        ]);

        $run2 = ReviewRun::factory()->create([
            'repository_id' => $repo->id,
            'status' => ReviewRunStatus::Completed,
            'completed_at' => now(),
        ]);

        ComplexitySnapshot::factory()->create([
            'review_run_id' => $run2->id,
            'repository_id' => $repo->id,
            'filepath' => 'src/auth.ts',
            'symbol_name' => 'login',
            'cyclomatic' => 15,
            'cognitive' => 18,
        ]);

        $response = $this->actingAs($user)->get("/repos/{$repo->id}/dashboard");

        $response->assertOk();
        $response->assertInertia(fn ($page) => $page
            ->component('Repositories/Dashboard')
            ->where('totalRuns', 2)
            ->whereNot('lastReviewDate', null)
            ->has('repository')
            ->has('organization')
        );
    }
}
