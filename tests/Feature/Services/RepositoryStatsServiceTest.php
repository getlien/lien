<?php

namespace Tests\Feature\Services;

use App\Enums\ReviewCommentStatus;
use App\Enums\ReviewRunStatus;
use App\Models\ComplexitySnapshot;
use App\Models\Repository;
use App\Models\ReviewComment;
use App\Models\ReviewRun;
use App\Services\RepositoryStatsService;
use Illuminate\Foundation\Testing\RefreshDatabase;
use Tests\TestCase;

class RepositoryStatsServiceTest extends TestCase
{
    use RefreshDatabase;

    private RepositoryStatsService $service;

    private Repository $repository;

    protected function setUp(): void
    {
        parent::setUp();
        $this->service = app(RepositoryStatsService::class);
        $this->repository = Repository::factory()->create();
    }

    public function test_get_trend_data_returns_completed_runs_in_order(): void
    {
        $older = ReviewRun::factory()->create([
            'repository_id' => $this->repository->id,
            'status' => ReviewRunStatus::Completed,
            'completed_at' => now()->subDays(3),
            'pr_number' => 10,
            'avg_complexity' => 5.50,
            'max_complexity' => 12.00,
        ]);

        $newer = ReviewRun::factory()->create([
            'repository_id' => $this->repository->id,
            'status' => ReviewRunStatus::Completed,
            'completed_at' => now()->subDay(),
            'pr_number' => 11,
            'avg_complexity' => 7.25,
            'max_complexity' => 18.00,
        ]);

        // Baseline run should also appear in trend data
        ReviewRun::factory()->baseline()->create([
            'repository_id' => $this->repository->id,
            'status' => ReviewRunStatus::Completed,
            'committed_at' => now()->subDays(2),
            'completed_at' => now()->subDays(2),
            'avg_complexity' => 6.00,
            'max_complexity' => 15.00,
        ]);

        // Pending run should be excluded
        ReviewRun::factory()->pending()->create([
            'repository_id' => $this->repository->id,
        ]);

        $result = $this->service->getTrendData($this->repository);

        $this->assertCount(3, $result);
        $this->assertEquals('pr', $result[0]['type']);
        $this->assertEquals(10, $result[0]['pr_number']);
        $this->assertEquals('baseline', $result[1]['type']);
        $this->assertNull($result[1]['pr_number']);
        $this->assertEquals('pr', $result[2]['type']);
        $this->assertEquals(11, $result[2]['pr_number']);
        $this->assertEquals(5.50, $result[0]['avg_complexity']);
        $this->assertEquals(18.00, $result[2]['max_complexity']);
    }

    public function test_get_trend_data_returns_empty_for_no_completed_runs(): void
    {
        ReviewRun::factory()->pending()->create([
            'repository_id' => $this->repository->id,
        ]);

        $result = $this->service->getTrendData($this->repository);

        $this->assertEmpty($result);
    }

    public function test_get_trend_data_handles_null_complexity_values(): void
    {
        ReviewRun::factory()->create([
            'repository_id' => $this->repository->id,
            'status' => ReviewRunStatus::Completed,
            'completed_at' => now(),
            'avg_complexity' => null,
            'max_complexity' => null,
        ]);

        $result = $this->service->getTrendData($this->repository);

        $this->assertCount(1, $result);
        $this->assertArrayHasKey('type', $result[0]);
        $this->assertNull($result[0]['avg_complexity']);
        $this->assertNull($result[0]['max_complexity']);
    }

    public function test_get_top_functions_returns_empty_when_no_runs(): void
    {
        $result = $this->service->getTopFunctions($this->repository);

        $this->assertEmpty($result);
    }

    public function test_get_top_functions_returns_top_10_by_cyclomatic(): void
    {
        $run = ReviewRun::factory()->baseline()->create([
            'repository_id' => $this->repository->id,
            'status' => ReviewRunStatus::Completed,
            'completed_at' => now(),
        ]);

        for ($i = 1; $i <= 12; $i++) {
            $this->createSnapshot("func_{$i}", "src/file_{$i}.ts", $i, $run, $i + 1);
        }

        $result = $this->service->getTopFunctions($this->repository);

        $this->assertCount(10, $result);
        $this->assertEquals('func_12', $result[0]['symbol_name']);
        $this->assertEquals(12, $result[0]['cyclomatic']);
        $this->assertEquals(13, $result[0]['cognitive']);
    }

    public function test_get_top_functions_calculates_trend_correctly(): void
    {
        $previousRun = ReviewRun::factory()->baseline()->create([
            'repository_id' => $this->repository->id,
            'status' => ReviewRunStatus::Completed,
            'completed_at' => now()->subDays(2),
        ]);

        $latestRun = ReviewRun::factory()->baseline()->create([
            'repository_id' => $this->repository->id,
            'status' => ReviewRunStatus::Completed,
            'completed_at' => now(),
        ]);

        // Previous run snapshots
        $this->createSnapshot('stableFunc', 'src/a.ts', 10, $previousRun);
        $this->createSnapshot('improvedFunc', 'src/b.ts', 15, $previousRun);
        $this->createSnapshot('worsenedFunc', 'src/c.ts', 8, $previousRun);

        // Latest run snapshots
        $this->createSnapshot('stableFunc', 'src/a.ts', 10, $latestRun);
        $this->createSnapshot('improvedFunc', 'src/b.ts', 12, $latestRun);
        $this->createSnapshot('worsenedFunc', 'src/c.ts', 14, $latestRun);
        $this->createSnapshot('newFunc', 'src/d.ts', 20, $latestRun);

        $result = $this->service->getTopFunctions($this->repository);
        $resultByName = collect($result)->keyBy('symbol_name');

        $this->assertEquals('new', $resultByName['newFunc']['trend']);
        $this->assertEquals('up', $resultByName['worsenedFunc']['trend']);
        $this->assertEquals('down', $resultByName['improvedFunc']['trend']);
        $this->assertEquals('stable', $resultByName['stableFunc']['trend']);
    }

    public function test_get_cluster_map_data_returns_empty_when_no_runs(): void
    {
        $result = $this->service->getClusterMapData($this->repository);

        $this->assertEmpty($result);
    }

    public function test_get_cluster_map_data_returns_top_50_sorted_by_cyclomatic(): void
    {
        $run = ReviewRun::factory()->baseline()->create([
            'repository_id' => $this->repository->id,
            'status' => ReviewRunStatus::Completed,
            'completed_at' => now(),
        ]);

        for ($i = 1; $i <= 55; $i++) {
            $this->createSnapshot("func_{$i}", "src/mod_{$i}/file.ts", $i, $run, $i + 1);
        }

        $result = $this->service->getClusterMapData($this->repository);

        $this->assertCount(50, $result);
        $this->assertEquals('func_55', $result[0]['symbol_name']);
        $this->assertEquals(55, $result[0]['cyclomatic']);
        $this->assertEquals(56, $result[0]['cognitive']);
        $this->assertEquals('func_6', $result[49]['symbol_name']);

        // Verify returned fields
        $this->assertArrayHasKey('id', $result[0]);
        $this->assertArrayHasKey('filepath', $result[0]);
        $this->assertArrayHasKey('line_start', $result[0]);
        $this->assertArrayHasKey('severity', $result[0]);
        $this->assertArrayNotHasKey('trend', $result[0]);
    }

    public function test_get_cluster_map_data_uses_latest_baseline_only(): void
    {
        $olderRun = ReviewRun::factory()->baseline()->create([
            'repository_id' => $this->repository->id,
            'status' => ReviewRunStatus::Completed,
            'completed_at' => now()->subDays(5),
        ]);

        $latestRun = ReviewRun::factory()->baseline()->create([
            'repository_id' => $this->repository->id,
            'status' => ReviewRunStatus::Completed,
            'completed_at' => now(),
        ]);

        $this->createSnapshot('oldFunc', 'src/old.ts', 100, $olderRun);
        $this->createSnapshot('newFunc', 'src/new.ts', 50, $latestRun);

        $result = $this->service->getClusterMapData($this->repository);

        $this->assertCount(1, $result);
        $this->assertEquals('newFunc', $result[0]['symbol_name']);
    }

    public function test_get_review_activity_counts_last_30_days(): void
    {
        // Run within 30 days
        $recentRun = ReviewRun::factory()->create([
            'repository_id' => $this->repository->id,
            'status' => ReviewRunStatus::Completed,
            'completed_at' => now()->subDays(5),
            'pr_number' => 42,
        ]);

        ReviewComment::factory()->create([
            'review_run_id' => $recentRun->id,
            'status' => ReviewCommentStatus::Posted,
        ]);

        ReviewComment::factory()->skipped()->create([
            'review_run_id' => $recentRun->id,
        ]);

        // Run older than 30 days — should be excluded
        $oldRun = ReviewRun::factory()->create([
            'repository_id' => $this->repository->id,
            'status' => ReviewRunStatus::Completed,
            'completed_at' => now()->subDays(45),
            'pr_number' => 10,
        ]);

        ReviewComment::factory()->create([
            'review_run_id' => $oldRun->id,
            'status' => ReviewCommentStatus::Posted,
        ]);

        $result = $this->service->getReviewActivity($this->repository);

        $this->assertEquals(1, $result['distinct_prs']);
        $this->assertEquals(1, $result['comments_posted']);
    }

    public function test_get_review_activity_returns_zeros_when_no_runs(): void
    {
        $result = $this->service->getReviewActivity($this->repository);

        $this->assertEquals(0, $result['distinct_prs']);
        $this->assertEquals(0, $result['comments_posted']);
    }

    public function test_get_cost_tracking_sums_last_30_days(): void
    {
        ReviewRun::factory()->create([
            'repository_id' => $this->repository->id,
            'status' => ReviewRunStatus::Completed,
            'completed_at' => now()->subDays(5),
            'token_usage' => 3000,
            'cost' => 0.10,
        ]);

        ReviewRun::factory()->create([
            'repository_id' => $this->repository->id,
            'status' => ReviewRunStatus::Completed,
            'completed_at' => now()->subDays(10),
            'token_usage' => 2000,
            'cost' => 0.05,
        ]);

        // Old run — excluded
        ReviewRun::factory()->create([
            'repository_id' => $this->repository->id,
            'status' => ReviewRunStatus::Completed,
            'completed_at' => now()->subDays(60),
            'token_usage' => 9999,
            'cost' => 1.00,
        ]);

        $result = $this->service->getCostTracking($this->repository);

        $this->assertEquals(5000, $result['total_tokens']);
        $this->assertEqualsWithDelta(0.15, $result['total_cost'], 0.001);
        $this->assertEquals(2, $result['total_runs']);
    }

    public function test_get_cost_tracking_returns_zeros_when_no_runs(): void
    {
        $result = $this->service->getCostTracking($this->repository);

        $this->assertEquals(0, $result['total_tokens']);
        $this->assertEquals(0.0, $result['total_cost']);
        $this->assertEquals(0, $result['total_runs']);
    }

    public function test_stats_exclude_data_from_other_repositories(): void
    {
        $otherRepo = Repository::factory()->create();

        // Data on the target repository
        $run = ReviewRun::factory()->create([
            'repository_id' => $this->repository->id,
            'status' => ReviewRunStatus::Completed,
            'completed_at' => now()->subDays(5),
            'pr_number' => 1,
            'token_usage' => 100,
            'cost' => 0.01,
        ]);

        ReviewComment::factory()->create([
            'review_run_id' => $run->id,
            'status' => ReviewCommentStatus::Posted,
        ]);

        // Data on a different repository — should be excluded
        $otherRun = ReviewRun::factory()->create([
            'repository_id' => $otherRepo->id,
            'status' => ReviewRunStatus::Completed,
            'completed_at' => now()->subDays(3),
            'pr_number' => 99,
            'token_usage' => 9999,
            'cost' => 5.00,
        ]);

        ReviewComment::factory()->count(3)->create([
            'review_run_id' => $otherRun->id,
            'status' => ReviewCommentStatus::Posted,
        ]);

        $trend = $this->service->getTrendData($this->repository);
        $this->assertCount(1, $trend);
        $this->assertEquals(1, $trend[0]['pr_number']);

        $activity = $this->service->getReviewActivity($this->repository);
        $this->assertEquals(1, $activity['distinct_prs']);
        $this->assertEquals(1, $activity['comments_posted']);

        $cost = $this->service->getCostTracking($this->repository);
        $this->assertEquals(100, $cost['total_tokens']);
        $this->assertEqualsWithDelta(0.01, $cost['total_cost'], 0.001);
        $this->assertEquals(1, $cost['total_runs']);
    }

    private function createSnapshot(string $symbolName, string $filepath, int $cyclomatic, ReviewRun $run, ?int $cognitive = null): void
    {
        ComplexitySnapshot::factory()->create([
            'review_run_id' => $run->id,
            'repository_id' => $this->repository->id,
            'symbol_name' => $symbolName,
            'filepath' => $filepath,
            'cyclomatic' => $cyclomatic,
            'cognitive' => $cognitive ?? $cyclomatic,
        ]);
    }
}
