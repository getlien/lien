<?php

namespace Tests\Feature\Services;

use App\Enums\ReviewRunStatus;
use App\Enums\ReviewRunType;
use App\Models\Repository;
use App\Models\ReviewRun;
use App\Services\ReviewRunService;
use Illuminate\Foundation\Testing\RefreshDatabase;
use Illuminate\Support\Str;
use Tests\TestCase;

class ReviewRunServiceTest extends TestCase
{
    use RefreshDatabase;

    private ReviewRunService $service;

    private Repository $repository;

    protected function setUp(): void
    {
        parent::setUp();
        $this->service = app(ReviewRunService::class);
        $this->repository = Repository::factory()->create();
    }

    public function test_create_review_run_with_all_related_entities(): void
    {
        $data = $this->basePayload([
            'complexity_snapshots' => [
                [
                    'filepath' => 'src/auth.ts',
                    'symbol_name' => 'login',
                    'symbol_type' => 'function',
                    'cyclomatic' => 12,
                    'cognitive' => 15,
                    'line_start' => 10,
                    'line_end' => 50,
                ],
            ],
            'review_comments' => [
                [
                    'review_type' => 'complexity',
                    'filepath' => 'src/auth.ts',
                    'line' => 15,
                    'body' => 'High complexity.',
                    'status' => 'posted',
                ],
            ],
        ]);

        $reviewRun = $this->service->createOrUpdate($data);

        $this->assertNotNull($reviewRun->id);
        $this->assertEquals(1, $reviewRun->complexitySnapshots()->count());
        $this->assertEquals(1, $reviewRun->reviewComments()->count());
    }

    public function test_idempotent_upsert_updates_existing_run(): void
    {
        $idempotencyKey = Str::random(64);

        $data = $this->basePayload([
            'idempotency_key' => $idempotencyKey,
            'files_analyzed' => 5,
        ]);

        $first = $this->service->createOrUpdate($data);

        $data['files_analyzed'] = 15;
        $second = $this->service->createOrUpdate($data);

        $this->assertEquals($first->id, $second->id);
        $this->assertEquals(15, $second->fresh()->files_analyzed);
    }

    public function test_upsert_replaces_related_entities_on_update(): void
    {
        $idempotencyKey = Str::random(64);

        $data = $this->basePayload([
            'idempotency_key' => $idempotencyKey,
            'complexity_snapshots' => [
                [
                    'filepath' => 'src/a.ts',
                    'symbol_name' => 'funcA',
                    'symbol_type' => 'function',
                    'cyclomatic' => 5,
                    'cognitive' => 3,
                    'line_start' => 1,
                    'line_end' => 10,
                ],
            ],
        ]);

        $run = $this->service->createOrUpdate($data);
        $this->assertEquals(1, $run->complexitySnapshots()->count());

        // Second call with different snapshots replaces them
        $data['complexity_snapshots'] = [
            [
                'filepath' => 'src/b.ts',
                'symbol_name' => 'funcB',
                'symbol_type' => 'function',
                'cyclomatic' => 8,
                'cognitive' => 6,
                'line_start' => 1,
                'line_end' => 20,
            ],
            [
                'filepath' => 'src/c.ts',
                'symbol_name' => 'funcC',
                'symbol_type' => 'function',
                'cyclomatic' => 3,
                'cognitive' => 2,
                'line_start' => 1,
                'line_end' => 5,
            ],
        ];

        $updated = $this->service->createOrUpdate($data);
        $this->assertEquals(2, $updated->complexitySnapshots()->count());
        $this->assertDatabaseMissing('complexity_snapshots', ['symbol_name' => 'funcA']);
    }

    public function test_upsert_does_not_delete_entities_when_key_absent(): void
    {
        $idempotencyKey = Str::random(64);

        $data = $this->basePayload([
            'idempotency_key' => $idempotencyKey,
            'complexity_snapshots' => [
                [
                    'filepath' => 'src/a.ts',
                    'symbol_name' => 'funcA',
                    'symbol_type' => 'function',
                    'cyclomatic' => 5,
                    'cognitive' => 3,
                    'line_start' => 1,
                    'line_end' => 10,
                ],
            ],
        ]);

        $this->service->createOrUpdate($data);

        // Update without complexity_snapshots key — should preserve existing
        $updateData = $this->basePayload([
            'idempotency_key' => $idempotencyKey,
            'files_analyzed' => 99,
        ]);

        $updated = $this->service->createOrUpdate($updateData);
        $this->assertEquals(99, $updated->fresh()->files_analyzed);
        $this->assertEquals(1, $updated->complexitySnapshots()->count());
    }

    public function test_update_status_to_running_sets_started_at(): void
    {
        $reviewRun = ReviewRun::factory()->pending()->create([
            'repository_id' => $this->repository->id,
        ]);

        $this->service->updateStatus($reviewRun, ReviewRunStatus::Running);

        $reviewRun->refresh();
        $this->assertEquals(ReviewRunStatus::Running, $reviewRun->status);
        $this->assertNotNull($reviewRun->started_at);
    }

    public function test_update_status_to_running_does_not_overwrite_started_at(): void
    {
        $originalStartedAt = now()->subMinutes(10);

        $reviewRun = ReviewRun::factory()->create([
            'repository_id' => $this->repository->id,
            'status' => ReviewRunStatus::Running,
            'started_at' => $originalStartedAt,
            'completed_at' => null,
        ]);

        $this->service->updateStatus($reviewRun, ReviewRunStatus::Running);

        $reviewRun->refresh();
        $this->assertEquals(
            $originalStartedAt->toDateTimeString(),
            $reviewRun->started_at->toDateTimeString(),
        );
    }

    public function test_update_status_to_completed_sets_completed_at(): void
    {
        $reviewRun = ReviewRun::factory()->running()->create([
            'repository_id' => $this->repository->id,
        ]);

        $this->service->updateStatus($reviewRun, ReviewRunStatus::Completed);

        $reviewRun->refresh();
        $this->assertEquals(ReviewRunStatus::Completed, $reviewRun->status);
        $this->assertNotNull($reviewRun->completed_at);
    }

    public function test_update_status_to_failed_sets_completed_at(): void
    {
        $reviewRun = ReviewRun::factory()->running()->create([
            'repository_id' => $this->repository->id,
        ]);

        $this->service->updateStatus($reviewRun, ReviewRunStatus::Failed);

        $reviewRun->refresh();
        $this->assertEquals(ReviewRunStatus::Failed, $reviewRun->status);
        $this->assertNotNull($reviewRun->completed_at);
    }

    public function test_empty_array_deletes_existing_entities(): void
    {
        $idempotencyKey = Str::random(64);

        $data = $this->basePayload([
            'idempotency_key' => $idempotencyKey,
            'complexity_snapshots' => [
                [
                    'filepath' => 'src/a.ts',
                    'symbol_name' => 'funcA',
                    'symbol_type' => 'function',
                    'cyclomatic' => 5,
                    'cognitive' => 3,
                    'line_start' => 1,
                    'line_end' => 10,
                ],
            ],
        ]);

        $run = $this->service->createOrUpdate($data);
        $this->assertEquals(1, $run->complexitySnapshots()->count());

        // Update with empty array — should delete existing
        $data['complexity_snapshots'] = [];
        $updated = $this->service->createOrUpdate($data);
        $this->assertEquals(0, $updated->complexitySnapshots()->count());
    }

    public function test_upsert_replaces_review_comments_on_update(): void
    {
        $idempotencyKey = Str::random(64);

        $data = $this->basePayload([
            'idempotency_key' => $idempotencyKey,
            'review_comments' => [
                [
                    'review_type' => 'complexity',
                    'filepath' => 'src/a.ts',
                    'line' => 10,
                    'body' => 'Original comment.',
                    'status' => 'posted',
                ],
            ],
        ]);

        $run = $this->service->createOrUpdate($data);
        $this->assertEquals(1, $run->reviewComments()->count());

        // Replace with different comments
        $data['review_comments'] = [
            [
                'review_type' => 'logic',
                'filepath' => 'src/b.ts',
                'line' => 20,
                'body' => 'New comment.',
                'status' => 'posted',
            ],
            [
                'review_type' => 'logic',
                'filepath' => 'src/c.ts',
                'line' => 30,
                'body' => 'Another comment.',
                'status' => 'skipped',
            ],
        ];

        $updated = $this->service->createOrUpdate($data);
        $this->assertEquals(2, $updated->reviewComments()->count());
        $this->assertDatabaseMissing('review_comments', ['body' => 'Original comment.']);
    }

    public function test_type_is_set_to_pr_when_pr_number_is_provided(): void
    {
        $data = $this->basePayload(['pr_number' => 42]);

        $reviewRun = $this->service->createOrUpdate($data);

        $this->assertEquals(ReviewRunType::Pr, $reviewRun->type);
    }

    public function test_type_is_set_to_baseline_when_pr_number_is_null(): void
    {
        $data = $this->basePayload(['pr_number' => null, 'base_sha' => null]);

        $reviewRun = $this->service->createOrUpdate($data);

        $this->assertEquals(ReviewRunType::Baseline, $reviewRun->type);
    }

    public function test_upsert_preserves_pr_metadata_when_keys_absent(): void
    {
        $headSha = str_repeat('d', 40);

        $data = $this->basePayload([
            'head_sha' => $headSha,
            'pr_title' => 'Add authentication',
            'head_ref' => 'feat/auth',
            'base_ref' => 'main',
        ]);

        $run = $this->service->createOrUpdate($data);
        $this->assertEquals('Add authentication', $run->pr_title);
        $this->assertEquals('feat/auth', $run->head_ref);
        $this->assertEquals('main', $run->base_ref);

        // Simulate runner callback without PR metadata keys
        $callbackData = $this->basePayload([
            'head_sha' => $headSha,
            'idempotency_key' => $run->idempotency_key,
            'files_analyzed' => 25,
            'status' => 'completed',
        ]);

        $updated = $this->service->createOrUpdate($callbackData);
        $updated->refresh();

        $this->assertEquals($run->id, $updated->id);
        $this->assertEquals(25, $updated->files_analyzed);
        $this->assertEquals('Add authentication', $updated->pr_title);
        $this->assertEquals('feat/auth', $updated->head_ref);
        $this->assertEquals('main', $updated->base_ref);
    }

    public function test_update_status_completed_to_running_still_applies(): void
    {
        $reviewRun = ReviewRun::factory()->create([
            'repository_id' => $this->repository->id,
            'status' => ReviewRunStatus::Completed,
            'started_at' => now()->subMinutes(10),
            'completed_at' => now()->subMinutes(5),
        ]);

        $this->service->updateStatus($reviewRun, ReviewRunStatus::Running);

        $reviewRun->refresh();
        $this->assertEquals(ReviewRunStatus::Running, $reviewRun->status);
        $this->assertNotNull($reviewRun->started_at);
    }

    /**
     * @param  array<string, mixed>  $overrides
     * @return array<string, mixed>
     */
    private function basePayload(array $overrides = []): array
    {
        return array_merge([
            'repository_id' => $this->repository->id,
            'pr_number' => 42,
            'head_sha' => str_repeat('a', 40),
            'base_sha' => str_repeat('b', 40),
            'idempotency_key' => Str::random(64),
            'status' => 'completed',
            'files_analyzed' => 10,
        ], $overrides);
    }
}
