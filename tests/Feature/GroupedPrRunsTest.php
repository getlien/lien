<?php

namespace Tests\Feature;

use App\Enums\ReviewRunStatus;
use App\Models\Organization;
use App\Models\Repository;
use App\Models\ReviewComment;
use App\Models\ReviewRun;
use App\Models\User;
use App\Services\RepositoryStatsService;
use Illuminate\Foundation\Testing\RefreshDatabase;
use Tests\TestCase;

class GroupedPrRunsTest extends TestCase
{
    use RefreshDatabase;

    private function createUserWithRepo(): array
    {
        $user = User::factory()->create();
        $org = Organization::factory()->create();
        $user->organizations()->attach($org->id, ['role' => 'admin']);
        $repo = Repository::factory()->create(['organization_id' => $org->id]);

        return [$user, $repo];
    }

    public function test_grouped_view_renders_runs_list_with_pr_groups(): void
    {
        [$user, $repo] = $this->createUserWithRepo();
        ReviewRun::factory()->count(2)->create([
            'repository_id' => $repo->id,
            'pr_number' => 42,
        ]);
        ReviewRun::factory()->create([
            'repository_id' => $repo->id,
            'pr_number' => 43,
        ]);

        $response = $this->actingAs($user)->get("/repos/{$repo->id}/runs?view=grouped");

        $response->assertOk();
        $response->assertInertia(fn ($page) => $page
            ->component('Repositories/RunsList')
            ->has('prGroups.data', 2)
            ->where('view', 'grouped')
        );
    }

    public function test_grouped_view_excludes_baseline_runs(): void
    {
        [$user, $repo] = $this->createUserWithRepo();
        ReviewRun::factory()->create([
            'repository_id' => $repo->id,
            'pr_number' => 42,
        ]);
        ReviewRun::factory()->baseline()->create([
            'repository_id' => $repo->id,
        ]);

        $response = $this->actingAs($user)->get("/repos/{$repo->id}/runs?view=grouped");

        $response->assertOk();
        $response->assertInertia(fn ($page) => $page
            ->has('prGroups.data', 1)
            ->where('prGroups.data.0.pr_number', 42)
        );
    }

    public function test_grouped_view_returns_correct_group_structure(): void
    {
        [$user, $repo] = $this->createUserWithRepo();
        ReviewRun::factory()->create([
            'repository_id' => $repo->id,
            'pr_number' => 10,
            'head_ref' => 'feat/test',
            'base_ref' => 'main',
            'status' => ReviewRunStatus::Completed,
            'avg_complexity' => 8.5,
            'max_complexity' => 20.0,
        ]);

        $response = $this->actingAs($user)->get("/repos/{$repo->id}/runs?view=grouped");

        $response->assertOk();
        $response->assertInertia(fn ($page) => $page
            ->where('prGroups.data.0.pr_number', 10)
            ->where('prGroups.data.0.head_ref', 'feat/test')
            ->where('prGroups.data.0.base_ref', 'main')
            ->where('prGroups.data.0.runs_count', 1)
            ->where('prGroups.data.0.latest_status', 'completed')
            ->has('prGroups.data.0.evolution')
            ->has('prGroups.data.0.delta')
            ->has('prGroups.data.0.runs')
        );
    }

    public function test_grouped_view_computes_delta_for_multi_run_prs(): void
    {
        [$user, $repo] = $this->createUserWithRepo();

        // First run: higher complexity
        ReviewRun::factory()->create([
            'repository_id' => $repo->id,
            'pr_number' => 50,
            'status' => ReviewRunStatus::Completed,
            'avg_complexity' => 12.50,
            'max_complexity' => 30.00,
            'created_at' => now()->subHours(2),
        ]);

        // Second run: lower complexity (improvement)
        ReviewRun::factory()->create([
            'repository_id' => $repo->id,
            'pr_number' => 50,
            'status' => ReviewRunStatus::Completed,
            'avg_complexity' => 8.50,
            'max_complexity' => 25.00,
            'created_at' => now()->subHour(),
        ]);

        $response = $this->actingAs($user)->get("/repos/{$repo->id}/runs?view=grouped");

        $response->assertOk();
        $response->assertInertia(fn ($page) => $page
            ->where('prGroups.data.0.runs_count', 2)
            ->where('prGroups.data.0.delta.avg_complexity_change', fn ($v) => (float) $v === -4.0)
            ->where('prGroups.data.0.delta.max_complexity_change', fn ($v) => (float) $v === -5.0)
        );
    }

    public function test_grouped_view_includes_comments_posted_count(): void
    {
        [$user, $repo] = $this->createUserWithRepo();
        $run = ReviewRun::factory()->create([
            'repository_id' => $repo->id,
            'pr_number' => 60,
        ]);
        ReviewComment::factory()->count(3)->create(['review_run_id' => $run->id, 'status' => 'posted']);
        ReviewComment::factory()->skipped()->create(['review_run_id' => $run->id]);

        $response = $this->actingAs($user)->get("/repos/{$repo->id}/runs?view=grouped");

        $response->assertOk();
        $response->assertInertia(fn ($page) => $page
            ->where('prGroups.data.0.runs.0.comments_posted_count', 3)
        );
    }

    public function test_grouped_view_single_run_pr_has_null_delta(): void
    {
        [$user, $repo] = $this->createUserWithRepo();
        ReviewRun::factory()->create([
            'repository_id' => $repo->id,
            'pr_number' => 70,
            'status' => ReviewRunStatus::Completed,
        ]);

        $response = $this->actingAs($user)->get("/repos/{$repo->id}/runs?view=grouped");

        $response->assertOk();
        $response->assertInertia(fn ($page) => $page
            ->where('prGroups.data.0.delta.avg_complexity_change', null)
            ->where('prGroups.data.0.delta.max_complexity_change', null)
            ->where('prGroups.data.0.delta.comments_change', null)
        );
    }

    public function test_default_view_is_grouped_without_view_param(): void
    {
        [$user, $repo] = $this->createUserWithRepo();
        ReviewRun::factory()->count(3)->create([
            'repository_id' => $repo->id,
            'pr_number' => 1,
        ]);

        $response = $this->actingAs($user)->get("/repos/{$repo->id}/runs");

        $response->assertOk();
        $response->assertInertia(fn ($page) => $page
            ->component('Repositories/RunsList')
            ->has('prGroups')
            ->where('view', 'grouped')
        );
    }

    public function test_all_view_preserves_existing_filter_behavior(): void
    {
        [$user, $repo] = $this->createUserWithRepo();
        ReviewRun::factory()->count(2)->create(['repository_id' => $repo->id]);
        ReviewRun::factory()->baseline()->create(['repository_id' => $repo->id]);

        $response = $this->actingAs($user)->get("/repos/{$repo->id}/runs?view=all&type=baseline");

        $response->assertOk();
        $response->assertInertia(fn ($page) => $page
            ->has('runs.data', 1)
            ->where('view', 'all')
        );
    }

    public function test_grouped_view_non_member_cannot_access(): void
    {
        $user = User::factory()->create();
        $repo = Repository::factory()->create();

        $response = $this->actingAs($user)->get("/repos/{$repo->id}/runs?view=grouped");

        $response->assertForbidden();
    }

    public function test_grouped_view_empty_state(): void
    {
        [$user, $repo] = $this->createUserWithRepo();

        $response = $this->actingAs($user)->get("/repos/{$repo->id}/runs?view=grouped");

        $response->assertOk();
        $response->assertInertia(fn ($page) => $page
            ->has('prGroups.data', 0)
            ->where('prGroups.has_more', false)
        );
    }

    public function test_stats_service_groups_by_pr_number(): void
    {
        [$user, $repo] = $this->createUserWithRepo();

        ReviewRun::factory()->count(3)->create([
            'repository_id' => $repo->id,
            'pr_number' => 1,
        ]);
        ReviewRun::factory()->count(2)->create([
            'repository_id' => $repo->id,
            'pr_number' => 2,
        ]);

        $service = app(RepositoryStatsService::class);
        $result = $service->getGroupedPrRuns($repo);

        $this->assertCount(2, $result['data']);
        $this->assertEquals(2, $result['total']);
        $this->assertFalse($result['has_more']);

        $prNumbers = collect($result['data'])->pluck('pr_number')->all();
        $this->assertContains(1, $prNumbers);
        $this->assertContains(2, $prNumbers);
    }

    public function test_stats_service_pagination(): void
    {
        [$user, $repo] = $this->createUserWithRepo();

        // Create 25 distinct PRs
        for ($i = 1; $i <= 25; $i++) {
            ReviewRun::factory()->create([
                'repository_id' => $repo->id,
                'pr_number' => $i,
            ]);
        }

        $service = app(RepositoryStatsService::class);

        $page1 = $service->getGroupedPrRuns($repo, 1, 20);
        $this->assertCount(20, $page1['data']);
        $this->assertEquals(25, $page1['total']);
        $this->assertTrue($page1['has_more']);

        $page2 = $service->getGroupedPrRuns($repo, 2, 20);
        $this->assertCount(5, $page2['data']);
        $this->assertFalse($page2['has_more']);
    }

    public function test_stats_service_evolution_only_includes_completed_runs(): void
    {
        [$user, $repo] = $this->createUserWithRepo();

        ReviewRun::factory()->create([
            'repository_id' => $repo->id,
            'pr_number' => 80,
            'status' => ReviewRunStatus::Completed,
            'avg_complexity' => 10.0,
            'created_at' => now()->subHour(),
        ]);
        ReviewRun::factory()->running()->create([
            'repository_id' => $repo->id,
            'pr_number' => 80,
            'created_at' => now(),
        ]);

        $service = app(RepositoryStatsService::class);
        $result = $service->getGroupedPrRuns($repo);

        $group = $result['data'][0];
        $this->assertCount(1, $group['evolution']);
        $this->assertCount(2, $group['runs']);
    }
}
