<?php

namespace Tests\Feature\Api\V1;

use App\Enums\ReviewRunStatus;
use App\Models\Repository;
use App\Models\ReviewRun;
use Illuminate\Foundation\Testing\RefreshDatabase;
use Illuminate\Support\Str;
use Tests\TestCase;
use Tests\Traits\WithServiceToken;

class ReviewRunTest extends TestCase
{
    use RefreshDatabase;
    use WithServiceToken;

    protected function setUp(): void
    {
        parent::setUp();
        $this->setUpServiceToken();
    }

    public function test_create_review_run(): void
    {
        $repo = Repository::factory()->create();

        $response = $this->postJson('/api/v1/review-runs', [
            'repo_id' => $repo->id,
            'pr_number' => 42,
            'head_sha' => str_repeat('a', 40),
            'base_sha' => str_repeat('b', 40),
            'idempotency_key' => Str::random(64),
            'status' => 'completed',
            'files_analyzed' => 10,
            'avg_complexity' => 8.5,
            'max_complexity' => 22.0,
            'token_usage' => 5000,
            'cost' => 0.12,
            'complexity_snapshots' => [
                [
                    'filepath' => 'src/auth.ts',
                    'symbol_name' => 'login',
                    'symbol_type' => 'function',
                    'complexity' => 12,
                    'start_line' => 10,
                    'severity' => 'warning',
                ],
            ],
            'review_comments' => [
                [
                    'plugin_id' => 'complexity',
                    'filepath' => 'src/auth.ts',
                    'line' => 15,
                    'message' => 'High complexity detected.',
                    'github_comment_id' => 123456789,
                ],
            ],
        ], $this->serviceTokenHeaders($repo->id));

        $response->assertCreated();
        $response->assertJsonStructure(['review_run_id']);

        $this->assertDatabaseHas('review_runs', [
            'repository_id' => $repo->id,
            'pr_number' => 42,
            'files_analyzed' => 10,
        ]);

        $reviewRun = ReviewRun::find($response->json('review_run_id'));
        $this->assertEquals(1, $reviewRun->complexitySnapshots()->count());
        $this->assertEquals(1, $reviewRun->reviewComments()->count());
    }

    public function test_create_review_run_idempotent(): void
    {
        $repo = Repository::factory()->create();
        $idempotencyKey = Str::random(64);

        $payload = [
            'repo_id' => $repo->id,
            'pr_number' => 42,
            'head_sha' => str_repeat('a', 40),
            'base_sha' => str_repeat('b', 40),
            'idempotency_key' => $idempotencyKey,
            'status' => 'completed',
            'files_analyzed' => 10,
            'complexity_snapshots' => [
                [
                    'filepath' => 'src/auth.ts',
                    'symbol_name' => 'login',
                    'symbol_type' => 'function',
                    'complexity' => 12,
                    'start_line' => 10,
                ],
            ],
        ];

        $headers = $this->serviceTokenHeaders($repo->id);

        $response1 = $this->postJson('/api/v1/review-runs', $payload, $headers);

        $payload['files_analyzed'] = 20;
        $payload['complexity_snapshots'][] = [
            'filepath' => 'src/utils.ts',
            'symbol_name' => 'helper',
            'symbol_type' => 'function',
            'complexity' => 5,
            'start_line' => 1,
        ];

        $response2 = $this->postJson('/api/v1/review-runs', $payload, $headers);

        $response1->assertCreated();
        $response2->assertOk();

        $this->assertEquals(
            $response1->json('review_run_id'),
            $response2->json('review_run_id'),
        );

        $reviewRun = ReviewRun::find($response2->json('review_run_id'));
        $this->assertEquals(20, $reviewRun->files_analyzed);
        $this->assertEquals(2, $reviewRun->complexitySnapshots()->count());
    }

    public function test_create_review_run_normalizes_short_head_sha_to_null(): void
    {
        $repo = Repository::factory()->create();

        $response = $this->postJson('/api/v1/review-runs', [
            'repo_id' => $repo->id,
            'pr_number' => 42,
            'head_sha' => 'main', // branch name fallback from runner
            'base_sha' => str_repeat('b', 40),
            'idempotency_key' => Str::random(64),
        ], $this->serviceTokenHeaders($repo->id));

        $response->assertCreated();
        $this->assertNull(ReviewRun::find($response->json('review_run_id'))->head_sha);
    }

    public function test_create_review_run_nonexistent_repo(): void
    {
        $response = $this->postJson('/api/v1/review-runs', [
            'repo_id' => 99999,
            'pr_number' => 42,
            'head_sha' => str_repeat('a', 40),
            'base_sha' => str_repeat('b', 40),
            'idempotency_key' => Str::random(64),
        ], $this->serviceTokenHeaders(99999));

        $response->assertUnprocessable();
        $response->assertJsonValidationErrors('repository_id');
    }

    public function test_update_review_run_status(): void
    {
        $reviewRun = ReviewRun::factory()->pending()->create();

        $response = $this->postJson(
            "/api/v1/review-runs/{$reviewRun->id}/status",
            ['status' => 'running'],
            $this->serviceTokenHeaders($reviewRun->repository_id, $reviewRun->id),
        );

        $response->assertOk();
        $response->assertJson(['status' => 'running']);

        $reviewRun->refresh();
        $this->assertEquals(ReviewRunStatus::Running, $reviewRun->status);
        $this->assertNotNull($reviewRun->started_at);
    }

    public function test_update_review_run_status_sets_completed_at(): void
    {
        $reviewRun = ReviewRun::factory()->running()->create();

        $response = $this->postJson(
            "/api/v1/review-runs/{$reviewRun->id}/status",
            ['status' => 'completed'],
            $this->serviceTokenHeaders($reviewRun->repository_id, $reviewRun->id),
        );

        $response->assertOk();

        $reviewRun->refresh();
        $this->assertEquals(ReviewRunStatus::Completed, $reviewRun->status);
        $this->assertNotNull($reviewRun->completed_at);
    }

    public function test_update_review_run_status_sets_completed_at_on_failed(): void
    {
        $reviewRun = ReviewRun::factory()->running()->create();

        $response = $this->postJson(
            "/api/v1/review-runs/{$reviewRun->id}/status",
            ['status' => 'failed'],
            $this->serviceTokenHeaders($reviewRun->repository_id, $reviewRun->id),
        );

        $response->assertOk();
        $response->assertJson(['status' => 'failed']);

        $reviewRun->refresh();
        $this->assertEquals(ReviewRunStatus::Failed, $reviewRun->status);
        $this->assertNotNull($reviewRun->completed_at);
    }

    public function test_update_review_run_status_does_not_overwrite_started_at(): void
    {
        $originalStartedAt = now()->subMinutes(10);

        $reviewRun = ReviewRun::factory()->create([
            'status' => ReviewRunStatus::Running,
            'started_at' => $originalStartedAt,
            'completed_at' => null,
        ]);

        $response = $this->postJson(
            "/api/v1/review-runs/{$reviewRun->id}/status",
            ['status' => 'running'],
            $this->serviceTokenHeaders($reviewRun->repository_id, $reviewRun->id),
        );

        $response->assertOk();

        $reviewRun->refresh();
        $this->assertEquals(
            $originalStartedAt->toDateTimeString(),
            $reviewRun->started_at->toDateTimeString(),
        );
    }

    public function test_token_scoped_to_wrong_repo_returns_403(): void
    {
        $repo = Repository::factory()->create();
        $otherRepo = Repository::factory()->create();

        $response = $this->postJson('/api/v1/review-runs', [
            'repo_id' => $repo->id,
            'pr_number' => 42,
            'head_sha' => str_repeat('a', 40),
            'idempotency_key' => Str::random(64),
        ], $this->serviceTokenHeaders($otherRepo->id));

        $response->assertForbidden();
    }

    public function test_token_scoped_to_wrong_run_returns_403(): void
    {
        $reviewRun = ReviewRun::factory()->pending()->create();
        $otherRun = ReviewRun::factory()->pending()->create([
            'repository_id' => $reviewRun->repository_id,
        ]);

        $response = $this->postJson(
            "/api/v1/review-runs/{$reviewRun->id}/status",
            ['status' => 'running'],
            $this->serviceTokenHeaders($reviewRun->repository_id, $otherRun->id),
        );

        $response->assertForbidden();
    }

    public function test_baseline_token_without_rid_can_create_review_run(): void
    {
        $repo = Repository::factory()->create();

        $response = $this->postJson('/api/v1/review-runs', [
            'repo_id' => $repo->id,
            'head_sha' => str_repeat('a', 40),
            'base_sha' => str_repeat('b', 40),
            'idempotency_key' => Str::random(64),
            'status' => 'completed',
            'files_analyzed' => 5,
        ], $this->serviceTokenHeaders($repo->id));

        $response->assertCreated();
    }

    public function test_create_review_run_with_summary_comment(): void
    {
        $repo = Repository::factory()->create();

        $response = $this->postJson('/api/v1/review-runs', [
            'repo_id' => $repo->id,
            'pr_number' => 10,
            'head_sha' => str_repeat('c', 40),
            'base_sha' => str_repeat('d', 40),
            'idempotency_key' => Str::random(64),
            'status' => 'completed',
            'files_analyzed' => 3,
            'review_comments' => [
                [
                    'plugin_id' => 'summary',
                    'filepath' => '',
                    'line' => 0,
                    'message' => 'This PR refactors the auth module. Risk: low.',
                ],
                [
                    'plugin_id' => 'complexity',
                    'filepath' => 'src/auth.ts',
                    'line' => 42,
                    'message' => 'High complexity detected.',
                ],
            ],
        ], $this->serviceTokenHeaders($repo->id));

        $response->assertCreated();

        $reviewRun = ReviewRun::find($response->json('review_run_id'));
        $this->assertEquals(2, $reviewRun->reviewComments()->count());

        $summaryComment = $reviewRun->reviewComments()->where('review_type', 'summary')->first();
        $this->assertNull($summaryComment->filepath);
        $this->assertNull($summaryComment->line);

        $normalComment = $reviewRun->reviewComments()->where('review_type', 'complexity')->first();
        $this->assertEquals('src/auth.ts', $normalComment->filepath);
        $this->assertEquals(42, $normalComment->line);
    }

    public function test_baseline_token_without_rid_can_update_any_run_in_matching_repo(): void
    {
        $reviewRun = ReviewRun::factory()->pending()->create();

        $response = $this->postJson(
            "/api/v1/review-runs/{$reviewRun->id}/status",
            ['status' => 'running'],
            $this->serviceTokenHeaders($reviewRun->repository_id),
        );

        $response->assertOk();
    }
}
