<?php

namespace Tests\Feature\Services;

use App\Enums\ReviewRunStatus;
use App\Models\ReviewRun;
use App\Services\GitHubCheckService;
use Illuminate\Foundation\Testing\RefreshDatabase;
use Illuminate\Support\Facades\Http;
use Tests\TestCase;

class GitHubCheckServiceTest extends TestCase
{
    use RefreshDatabase;

    private GitHubCheckService $service;

    protected function setUp(): void
    {
        parent::setUp();
        $this->service = new GitHubCheckService;
    }

    public function test_create_check_run(): void
    {
        Http::fake([
            'api.github.com/repos/*/check-runs' => Http::response(['id' => 12345], 201),
        ]);

        $reviewRun = ReviewRun::factory()->pending()->create([
            'head_sha' => str_repeat('a', 40),
        ]);
        $reviewRun->load('repository');

        $checkRunId = $this->service->createCheckRun($reviewRun, 'fake-token');

        $this->assertEquals(12345, $checkRunId);

        Http::assertSent(function ($request) use ($reviewRun) {
            return $request['name'] === 'Lien Review'
                && $request['head_sha'] === $reviewRun->head_sha
                && $request['status'] === 'queued'
                && str_contains($request['details_url'], "/runs/{$reviewRun->id}");
        });
    }

    public function test_create_check_run_returns_null_without_head_sha(): void
    {
        $reviewRun = ReviewRun::factory()->pending()->create([
            'head_sha' => null,
        ]);

        $checkRunId = $this->service->createCheckRun($reviewRun, 'fake-token');

        $this->assertNull($checkRunId);
    }

    public function test_create_check_run_returns_null_on_api_failure(): void
    {
        Http::fake([
            'api.github.com/repos/*/check-runs' => Http::response('Not found', 404),
        ]);

        $reviewRun = ReviewRun::factory()->pending()->create([
            'head_sha' => str_repeat('a', 40),
        ]);
        $reviewRun->load('repository');

        $checkRunId = $this->service->createCheckRun($reviewRun, 'fake-token');

        $this->assertNull($checkRunId);
    }

    public function test_update_check_run_to_in_progress(): void
    {
        Http::fake([
            'api.github.com/repos/*/check-runs/*' => Http::response([], 200),
        ]);

        $reviewRun = ReviewRun::factory()->running()->create([
            'head_sha' => str_repeat('a', 40),
        ]);
        $reviewRun->load('repository');

        $this->service->updateCheckRun($reviewRun, 12345, 'fake-token');

        Http::assertSent(function ($request) {
            return $request['status'] === 'in_progress'
                && ! isset($request['conclusion']);
        });
    }

    public function test_update_check_run_to_completed(): void
    {
        Http::fake([
            'api.github.com/repos/*/check-runs/*' => Http::response([], 200),
        ]);

        $reviewRun = ReviewRun::factory()->create([
            'status' => ReviewRunStatus::Completed,
            'head_sha' => str_repeat('a', 40),
        ]);
        $reviewRun->load('repository');

        $this->service->updateCheckRun($reviewRun, 12345, 'fake-token');

        Http::assertSent(function ($request) {
            return $request['status'] === 'completed'
                && $request['conclusion'] === 'success';
        });
    }

    public function test_update_check_run_to_failed(): void
    {
        Http::fake([
            'api.github.com/repos/*/check-runs/*' => Http::response([], 200),
        ]);

        $reviewRun = ReviewRun::factory()->failed()->create([
            'head_sha' => str_repeat('a', 40),
        ]);
        $reviewRun->load('repository');

        $this->service->updateCheckRun($reviewRun, 12345, 'fake-token');

        Http::assertSent(function ($request) {
            return $request['status'] === 'completed'
                && $request['conclusion'] === 'failure';
        });
    }
}
