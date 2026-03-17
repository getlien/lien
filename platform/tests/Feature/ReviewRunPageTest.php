<?php

namespace Tests\Feature;

use App\Enums\ReviewRunStatus;
use App\Enums\Severity;
use App\Models\ComplexitySnapshot;
use App\Models\Organization;
use App\Models\Repository;
use App\Models\ReviewComment;
use App\Models\ReviewRun;
use App\Models\ReviewRunLog;
use App\Models\User;
use Illuminate\Foundation\Testing\RefreshDatabase;
use Tests\TestCase;

class ReviewRunPageTest extends TestCase
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

    public function test_index_renders_runs_list(): void
    {
        [$user, $repo] = $this->createUserWithRepo();
        ReviewRun::factory()->count(3)->create(['repository_id' => $repo->id]);

        $response = $this->actingAs($user)->get("/repos/{$repo->id}/runs?view=all");

        $response->assertOk();
        $response->assertInertia(fn ($page) => $page
            ->component('Repositories/RunsList')
            ->has('repository')
            ->has('organization')
            ->has('runs.data', 3)
            ->has('filters')
        );
    }

    public function test_index_filters_by_type(): void
    {
        [$user, $repo] = $this->createUserWithRepo();
        ReviewRun::factory()->count(2)->create(['repository_id' => $repo->id]);
        ReviewRun::factory()->baseline()->create(['repository_id' => $repo->id]);

        $response = $this->actingAs($user)->get("/repos/{$repo->id}/runs?view=all&type=baseline");

        $response->assertOk();
        $response->assertInertia(fn ($page) => $page
            ->has('runs.data', 1)
            ->where('runs.data.0.type', 'baseline')
        );
    }

    public function test_index_filters_by_status(): void
    {
        [$user, $repo] = $this->createUserWithRepo();
        ReviewRun::factory()->count(2)->create([
            'repository_id' => $repo->id,
            'status' => ReviewRunStatus::Completed,
        ]);
        ReviewRun::factory()->failed()->create(['repository_id' => $repo->id]);

        $response = $this->actingAs($user)->get("/repos/{$repo->id}/runs?view=all&status=failed");

        $response->assertOk();
        $response->assertInertia(fn ($page) => $page
            ->has('runs.data', 1)
            ->where('runs.data.0.status', 'failed')
        );
    }

    public function test_index_non_member_cannot_access(): void
    {
        $user = User::factory()->create();
        $repo = Repository::factory()->create();

        $response = $this->actingAs($user)->get("/repos/{$repo->id}/runs");

        $response->assertForbidden();
    }

    public function test_index_paginates_results(): void
    {
        [$user, $repo] = $this->createUserWithRepo();
        ReviewRun::factory()->count(20)->create(['repository_id' => $repo->id]);

        $response = $this->actingAs($user)->get("/repos/{$repo->id}/runs?view=all");

        $response->assertOk();
        $response->assertInertia(fn ($page) => $page
            ->has('runs.data', 15)
            ->where('runs.total', 20)
            ->where('runs.last_page', 2)
        );
    }

    public function test_index_pagination_preserves_filters(): void
    {
        [$user, $repo] = $this->createUserWithRepo();
        ReviewRun::factory()->count(20)->failed()->create(['repository_id' => $repo->id]);
        ReviewRun::factory()->count(5)->create([
            'repository_id' => $repo->id,
            'status' => ReviewRunStatus::Completed,
        ]);

        $response = $this->actingAs($user)->get("/repos/{$repo->id}/runs?view=all&status=failed");

        $response->assertOk();
        $response->assertInertia(fn ($page) => $page
            ->has('runs.data', 15)
            ->where('runs.total', 20)
            ->where('runs.links', fn ($links) => collect($links)
                ->filter(fn ($link) => $link['url'] !== null)
                ->every(fn ($link) => str_contains($link['url'], 'status=failed'))
            )
        );
    }

    public function test_index_normalizes_invalid_filter_values(): void
    {
        [$user, $repo] = $this->createUserWithRepo();
        ReviewRun::factory()->count(3)->create(['repository_id' => $repo->id]);

        $response = $this->actingAs($user)->get("/repos/{$repo->id}/runs?view=all&type=invalid&status=bogus");

        $response->assertOk();
        $response->assertInertia(fn ($page) => $page
            ->has('runs.data', 3)
            ->where('filters.type', null)
            ->where('filters.status', null)
        );
    }

    public function test_show_review_run_page(): void
    {
        [$user, $repo] = $this->createUserWithRepo();
        $run = ReviewRun::factory()->running()->create(['repository_id' => $repo->id]);

        $response = $this->actingAs($user)->get("/repos/{$repo->id}/runs/{$run->id}");

        $response->assertOk();
        $response->assertInertia(fn ($page) => $page
            ->component('Repositories/ReviewRun')
            ->has('repository')
            ->has('organization')
            ->has('reviewRun')
            ->where('reviewRun.id', $run->id)
            ->where('reviewRun.status', 'running')
        );
    }

    public function test_show_completed_review_run_page(): void
    {
        [$user, $repo] = $this->createUserWithRepo();
        $run = ReviewRun::factory()->create([
            'repository_id' => $repo->id,
            'status' => ReviewRunStatus::Completed,
        ]);

        ReviewComment::factory()->count(2)->create(['review_run_id' => $run->id]);

        $response = $this->actingAs($user)->get("/repos/{$repo->id}/runs/{$run->id}");

        $response->assertOk();
        $response->assertInertia(fn ($page) => $page
            ->component('Repositories/ReviewRun')
            ->where('reviewRun.status', 'completed')
        );
    }

    public function test_review_run_must_belong_to_repository(): void
    {
        [$user, $repo] = $this->createUserWithRepo();
        $otherRepo = Repository::factory()->create();
        $run = ReviewRun::factory()->create(['repository_id' => $otherRepo->id]);

        $response = $this->actingAs($user)->get("/repos/{$repo->id}/runs/{$run->id}");

        $response->assertNotFound();
    }

    public function test_non_member_cannot_view_review_run(): void
    {
        $user = User::factory()->create();
        $repo = Repository::factory()->create();
        $run = ReviewRun::factory()->create(['repository_id' => $repo->id]);

        $response = $this->actingAs($user)->get("/repos/{$repo->id}/runs/{$run->id}");

        $response->assertForbidden();
    }

    public function test_guest_redirected_from_review_run(): void
    {
        $repo = Repository::factory()->create();
        $run = ReviewRun::factory()->create(['repository_id' => $repo->id]);

        $response = $this->get("/repos/{$repo->id}/runs/{$run->id}");

        $response->assertRedirect('/');
    }

    public function test_logs_endpoint_returns_logs(): void
    {
        [$user, $repo] = $this->createUserWithRepo();
        $run = ReviewRun::factory()->running()->create(['repository_id' => $repo->id]);

        ReviewRunLog::factory()->count(3)->create(['review_run_id' => $run->id]);

        $response = $this->actingAs($user)->getJson("/repos/{$repo->id}/runs/{$run->id}/logs");

        $response->assertOk();
        $response->assertJsonCount(3, 'logs');
        $response->assertJsonStructure([
            'logs' => [['id', 'level', 'message', 'logged_at']],
            'status',
        ]);
    }

    public function test_logs_endpoint_supports_cursor(): void
    {
        [$user, $repo] = $this->createUserWithRepo();
        $run = ReviewRun::factory()->running()->create(['repository_id' => $repo->id]);

        $logs = ReviewRunLog::factory()->count(5)->create(['review_run_id' => $run->id]);
        $afterId = $logs->sortBy('id')->values()[2]->id;

        $response = $this->actingAs($user)->getJson("/repos/{$repo->id}/runs/{$run->id}/logs?after={$afterId}");

        $response->assertOk();
        $response->assertJsonCount(2, 'logs');
    }

    public function test_logs_endpoint_includes_current_status(): void
    {
        [$user, $repo] = $this->createUserWithRepo();
        $run = ReviewRun::factory()->create([
            'repository_id' => $repo->id,
            'status' => ReviewRunStatus::Completed,
        ]);

        $response = $this->actingAs($user)->getJson("/repos/{$repo->id}/runs/{$run->id}/logs");

        $response->assertOk();
        $response->assertJson(['status' => 'completed']);
    }

    public function test_logs_endpoint_requires_auth(): void
    {
        $repo = Repository::factory()->create();
        $run = ReviewRun::factory()->create(['repository_id' => $repo->id]);

        $response = $this->getJson("/repos/{$repo->id}/runs/{$run->id}/logs");

        $response->assertUnauthorized();
    }

    public function test_show_includes_expanded_review_run_props(): void
    {
        [$user, $repo] = $this->createUserWithRepo();
        $run = ReviewRun::factory()->create([
            'repository_id' => $repo->id,
            'status' => ReviewRunStatus::Completed,
            'avg_complexity' => 12.50,
            'max_complexity' => 35.25,
            'summary_comment_id' => 123456,
            'github_check_run_id' => 789,
            'head_ref' => 'feat/add-auth',
            'base_ref' => 'main',
        ]);

        $response = $this->actingAs($user)->get("/repos/{$repo->id}/runs/{$run->id}");

        $response->assertOk();
        $response->assertInertia(fn ($page) => $page
            ->component('Repositories/ReviewRun')
            ->where('reviewRun.avg_complexity', 12.5)
            ->where('reviewRun.max_complexity', 35.25)
            ->where('reviewRun.summary_comment_id', 123456)
            ->where('reviewRun.github_check_run_id', 789)
            ->where('reviewRun.head_ref', 'feat/add-auth')
            ->where('reviewRun.base_ref', 'main')
            ->has('reviewRun.duration_seconds')
        );
    }

    public function test_show_review_comments_include_github_fields(): void
    {
        [$user, $repo] = $this->createUserWithRepo();
        $run = ReviewRun::factory()->create([
            'repository_id' => $repo->id,
            'status' => ReviewRunStatus::Completed,
        ]);

        ReviewComment::factory()->create([
            'review_run_id' => $run->id,
            'github_comment_id' => 111222,
            'resolution' => 'resolved',
        ]);

        // Use the controller's private method directly to verify fields
        $controller = app(\App\Http\Controllers\ReviewRunController::class);
        $method = new \ReflectionMethod($controller, 'getReviewComments');
        $comments = $method->invoke($controller, $run);

        $this->assertCount(1, $comments);
        $this->assertEquals(111222, $comments[0]['github_comment_id']);
        $this->assertEquals('resolved', $comments[0]['resolution']);
    }

    public function test_show_complexity_snapshots_ordered_by_severity_and_delta(): void
    {
        [$user, $repo] = $this->createUserWithRepo();
        $run = ReviewRun::factory()->create([
            'repository_id' => $repo->id,
            'status' => ReviewRunStatus::Completed,
        ]);

        ComplexitySnapshot::factory()->create([
            'review_run_id' => $run->id,
            'repository_id' => $repo->id,
            'symbol_name' => 'lowPriority',
            'severity' => Severity::None,
            'delta_cyclomatic' => 1,
        ]);

        ComplexitySnapshot::factory()->error()->create([
            'review_run_id' => $run->id,
            'repository_id' => $repo->id,
            'symbol_name' => 'highPriority',
            'delta_cyclomatic' => 5,
        ]);

        ComplexitySnapshot::factory()->warning()->create([
            'review_run_id' => $run->id,
            'repository_id' => $repo->id,
            'symbol_name' => 'medPriority',
            'delta_cyclomatic' => -3,
        ]);

        // Use the controller's private method via reflection
        $controller = app(\App\Http\Controllers\ReviewRunController::class);
        $method = new \ReflectionMethod($controller, 'getComplexitySnapshots');
        $snapshots = $method->invoke($controller, $run);

        $this->assertCount(3, $snapshots);
        $this->assertEquals('highPriority', $snapshots[0]['symbol_name']);
        $this->assertEquals('medPriority', $snapshots[1]['symbol_name']);
        $this->assertEquals('lowPriority', $snapshots[2]['symbol_name']);
    }

    public function test_show_delta_summary_computes_correctly(): void
    {
        [$user, $repo] = $this->createUserWithRepo();
        $run = ReviewRun::factory()->create([
            'repository_id' => $repo->id,
            'status' => ReviewRunStatus::Completed,
        ]);

        // Worsened: positive combined delta
        ComplexitySnapshot::factory()->create([
            'review_run_id' => $run->id,
            'repository_id' => $repo->id,
            'delta_cyclomatic' => 3,
            'delta_cognitive' => 2,
        ]);

        // Improved: negative combined delta
        ComplexitySnapshot::factory()->create([
            'review_run_id' => $run->id,
            'repository_id' => $repo->id,
            'delta_cyclomatic' => -4,
            'delta_cognitive' => -1,
        ]);

        // Unchanged: zero combined delta
        ComplexitySnapshot::factory()->create([
            'review_run_id' => $run->id,
            'repository_id' => $repo->id,
            'delta_cyclomatic' => 0,
            'delta_cognitive' => 0,
        ]);

        // Posted comment
        ReviewComment::factory()->create([
            'review_run_id' => $run->id,
            'status' => 'posted',
        ]);

        // Skipped comment (should not count)
        ReviewComment::factory()->skipped()->create([
            'review_run_id' => $run->id,
        ]);

        $controller = app(\App\Http\Controllers\ReviewRunController::class);
        $method = new \ReflectionMethod($controller, 'getDeltaSummary');
        $summary = $method->invoke($controller, $run);

        $this->assertEquals(1, $summary['worsened']);
        $this->assertEquals(1, $summary['improved']);
        $this->assertEquals(1, $summary['unchanged']);
        $this->assertEquals(-1, $summary['net_cyclomatic']); // 3 + (-4) + 0 = -1
        $this->assertEquals(1, $summary['net_cognitive']);  // 2 + (-1) + 0 = 1
        $this->assertEquals(1, $summary['comments_posted']);
    }

    public function test_show_review_run_includes_branch_refs(): void
    {
        [$user, $repo] = $this->createUserWithRepo();
        $run = ReviewRun::factory()->create([
            'repository_id' => $repo->id,
            'head_ref' => 'feat/new-feature',
            'base_ref' => 'develop',
        ]);

        $response = $this->actingAs($user)->get("/repos/{$repo->id}/runs/{$run->id}");

        $response->assertOk();
        $response->assertInertia(fn ($page) => $page
            ->where('reviewRun.head_ref', 'feat/new-feature')
            ->where('reviewRun.base_ref', 'develop')
        );
    }

    public function test_show_review_run_duration_calculated(): void
    {
        [$user, $repo] = $this->createUserWithRepo();
        $run = ReviewRun::factory()->create([
            'repository_id' => $repo->id,
            'started_at' => now()->subSeconds(45),
            'completed_at' => now(),
        ]);

        $response = $this->actingAs($user)->get("/repos/{$repo->id}/runs/{$run->id}");

        $response->assertOk();
        $response->assertInertia(fn ($page) => $page
            ->where('reviewRun.duration_seconds', fn ($value) => $value >= 44 && $value <= 46)
        );
    }
}
