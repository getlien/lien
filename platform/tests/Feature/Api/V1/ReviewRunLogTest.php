<?php

namespace Tests\Feature\Api\V1;

use App\Models\ReviewRun;
use Illuminate\Foundation\Testing\RefreshDatabase;
use Tests\TestCase;
use Tests\Traits\WithServiceToken;

class ReviewRunLogTest extends TestCase
{
    use RefreshDatabase;
    use WithServiceToken;

    protected function setUp(): void
    {
        parent::setUp();
        $this->setUpServiceToken();
    }

    public function test_store_logs_for_review_run(): void
    {
        $reviewRun = ReviewRun::factory()->running()->create();

        $response = $this->postJson(
            "/api/v1/review-runs/{$reviewRun->id}/logs",
            [
                'logs' => [
                    [
                        'level' => 'info',
                        'message' => 'Starting complexity analysis',
                        'logged_at' => now()->toIso8601String(),
                    ],
                    [
                        'level' => 'warning',
                        'message' => 'High complexity detected in auth.ts',
                        'logged_at' => now()->toIso8601String(),
                    ],
                ],
            ],
            $this->serviceTokenHeaders($reviewRun->repository_id, $reviewRun->id),
        );

        $response->assertOk();
        $response->assertJson(['stored' => 2]);

        $this->assertEquals(2, $reviewRun->logs()->count());
        $this->assertDatabaseHas('review_run_logs', [
            'review_run_id' => $reviewRun->id,
            'level' => 'info',
            'message' => 'Starting complexity analysis',
        ]);
    }

    public function test_store_logs_with_metadata(): void
    {
        $reviewRun = ReviewRun::factory()->running()->create();

        $response = $this->postJson(
            "/api/v1/review-runs/{$reviewRun->id}/logs",
            [
                'logs' => [
                    [
                        'level' => 'info',
                        'message' => 'Analyzing file',
                        'metadata' => ['file' => 'src/auth.ts', 'step' => 'complexity'],
                        'logged_at' => now()->toIso8601String(),
                    ],
                ],
            ],
            $this->serviceTokenHeaders($reviewRun->repository_id, $reviewRun->id),
        );

        $response->assertOk();

        $log = $reviewRun->logs()->first();
        $this->assertEquals(['file' => 'src/auth.ts', 'step' => 'complexity'], $log->metadata);
    }

    public function test_store_logs_validates_required_fields(): void
    {
        $reviewRun = ReviewRun::factory()->running()->create();

        $response = $this->postJson(
            "/api/v1/review-runs/{$reviewRun->id}/logs",
            [
                'logs' => [
                    ['level' => 'info'],
                ],
            ],
            $this->serviceTokenHeaders($reviewRun->repository_id, $reviewRun->id),
        );

        $response->assertUnprocessable();
        $response->assertJsonValidationErrors(['logs.0.message', 'logs.0.logged_at']);
    }

    public function test_store_logs_validates_level_enum(): void
    {
        $reviewRun = ReviewRun::factory()->running()->create();

        $response = $this->postJson(
            "/api/v1/review-runs/{$reviewRun->id}/logs",
            [
                'logs' => [
                    [
                        'level' => 'debug',
                        'message' => 'Test',
                        'logged_at' => now()->toIso8601String(),
                    ],
                ],
            ],
            $this->serviceTokenHeaders($reviewRun->repository_id, $reviewRun->id),
        );

        $response->assertUnprocessable();
        $response->assertJsonValidationErrors('logs.0.level');
    }

    public function test_store_logs_requires_at_least_one_entry(): void
    {
        $reviewRun = ReviewRun::factory()->running()->create();

        $response = $this->postJson(
            "/api/v1/review-runs/{$reviewRun->id}/logs",
            ['logs' => []],
            $this->serviceTokenHeaders($reviewRun->repository_id, $reviewRun->id),
        );

        $response->assertUnprocessable();
        $response->assertJsonValidationErrors('logs');
    }

    public function test_store_logs_requires_service_token(): void
    {
        $reviewRun = ReviewRun::factory()->running()->create();

        $response = $this->postJson(
            "/api/v1/review-runs/{$reviewRun->id}/logs",
            [
                'logs' => [
                    [
                        'level' => 'info',
                        'message' => 'Test',
                        'logged_at' => now()->toIso8601String(),
                    ],
                ],
            ],
        );

        $response->assertUnauthorized();
    }

    public function test_store_logs_for_nonexistent_review_run(): void
    {
        $response = $this->postJson(
            '/api/v1/review-runs/99999/logs',
            [
                'logs' => [
                    [
                        'level' => 'info',
                        'message' => 'Test',
                        'logged_at' => now()->toIso8601String(),
                    ],
                ],
            ],
            $this->serviceTokenHeaders(),
        );

        $response->assertNotFound();
    }

    public function test_store_logs_with_wrong_repo_scope_returns_403(): void
    {
        $reviewRun = ReviewRun::factory()->running()->create();

        $response = $this->postJson(
            "/api/v1/review-runs/{$reviewRun->id}/logs",
            [
                'logs' => [
                    [
                        'level' => 'info',
                        'message' => 'Test',
                        'logged_at' => now()->toIso8601String(),
                    ],
                ],
            ],
            $this->serviceTokenHeaders(99999, $reviewRun->id),
        );

        $response->assertForbidden();
    }
}
