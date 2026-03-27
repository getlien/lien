<?php

namespace Tests\Feature\Api\Webhooks;

use App\Enums\ReviewRunStatus;
use App\Jobs\ProcessPullRequestWebhook;
use App\Models\Organization;
use App\Models\Repository;
use App\Models\ReviewRun;
use App\Services\CreditService;
use App\Services\GitHubAppService;
use App\Services\GitHubCheckService;
use App\Services\NatsService;
use App\Services\RepoConfigService;
use App\Services\RunnerTokenService;
use Illuminate\Foundation\Testing\RefreshDatabase;
use Illuminate\Support\Facades\Http;
use Mockery\MockInterface;
use Tests\TestCase;

class ProcessPullRequestWebhookTest extends TestCase
{
    use RefreshDatabase;

    protected function setUp(): void
    {
        parent::setUp();
        config(['services.lien.service_token' => 'test-signing-key-that-is-at-least-32-bytes-long']);
        Http::fake([
            'api.github.com/repos/*/check-runs' => Http::response(['id' => 99999], 201),
            'api.github.com/repos/*/check-runs/*' => Http::response([], 200),
        ]);
    }

    public function test_happy_path_publishes_to_nats(): void
    {
        $org = Organization::factory()->withCredits(10)->create(['login' => 'test-org']);
        $repo = Repository::factory()->create([
            'organization_id' => $org->id,
            'full_name' => 'test-org/test-repo',
            'is_active' => true,
        ]);

        $this->mock(GitHubAppService::class, function (MockInterface $mock) {
            $mock->shouldReceive('getInstallationToken')
                ->once()
                ->with(12345)
                ->andReturn('ghs_test_token');
        });

        $tokenService = app(RunnerTokenService::class);

        $this->mock(NatsService::class, function (MockInterface $mock) use ($repo, $tokenService) {
            $mock->shouldReceive('publish')
                ->once()
                ->withArgs(function (string $subject, array $payload) use ($repo, $tokenService) {
                    if ($subject !== 'reviews.pr') {
                        return false;
                    }

                    $claims = $tokenService->validate($payload['auth']['service_token']);

                    return $payload['job_type'] === 'pr'
                        && $payload['repository']['full_name'] === 'test-org/test-repo'
                        && $payload['pull_request']['number'] === 42
                        && $payload['auth']['installation_token'] === 'ghs_test_token'
                        && $claims->repo === $repo->id
                        && $payload['review_run_id'] !== null
                        && $payload['check_run_id'] === 99999;
                });
        });

        $this->dispatchJob($this->webhookPayload());

        $this->assertDatabaseHas('review_runs', [
            'repository_id' => $repo->id,
            'pr_number' => 42,
            'status' => 'pending',
        ]);
    }

    public function test_ignores_unknown_repo(): void
    {
        $this->mock(NatsService::class, function (MockInterface $mock) {
            $mock->shouldNotReceive('publish');
        });

        $this->dispatchJob($this->webhookPayload());
    }

    public function test_ignores_inactive_repo(): void
    {
        $org = Organization::factory()->withCredits(5)->create(['login' => 'test-org']);
        Repository::factory()->create([
            'organization_id' => $org->id,
            'full_name' => 'test-org/test-repo',
            'is_active' => false,
        ]);

        $this->mock(NatsService::class, function (MockInterface $mock) {
            $mock->shouldNotReceive('publish');
        });

        $this->dispatchJob($this->webhookPayload());
    }

    public function test_stores_installation_id_on_organization(): void
    {
        $org = Organization::factory()->withCredits(5)->create([
            'login' => 'test-org',
            'github_installation_id' => null,
        ]);
        Repository::factory()->create([
            'organization_id' => $org->id,
            'full_name' => 'test-org/test-repo',
            'is_active' => true,
        ]);

        $this->mock(GitHubAppService::class, function (MockInterface $mock) {
            $mock->shouldReceive('getInstallationToken')->andReturn('ghs_test_token');
        });

        $this->mock(NatsService::class, function (MockInterface $mock) {
            $mock->shouldReceive('publish')->once();
        });

        $this->dispatchJob($this->webhookPayload());

        $this->assertDatabaseHas('organizations', [
            'id' => $org->id,
            'github_installation_id' => 12345,
        ]);
    }

    public function test_overwrites_existing_installation_id(): void
    {
        $org = Organization::factory()->withCredits(5)->create([
            'login' => 'test-org',
            'github_installation_id' => 11111,
        ]);
        Repository::factory()->create([
            'organization_id' => $org->id,
            'full_name' => 'test-org/test-repo',
            'is_active' => true,
        ]);

        $this->mock(GitHubAppService::class, function (MockInterface $mock) {
            $mock->shouldReceive('getInstallationToken')->andReturn('ghs_test_token');
        });

        $this->mock(NatsService::class, function (MockInterface $mock) {
            $mock->shouldReceive('publish')->once();
        });

        $this->dispatchJob($this->webhookPayload());

        $this->assertDatabaseHas('organizations', [
            'id' => $org->id,
            'github_installation_id' => 12345,
        ]);
    }

    public function test_skips_duplicate_dispatch_for_existing_review_run(): void
    {
        $org = Organization::factory()->withCredits(5)->create(['login' => 'test-org']);
        $repo = Repository::factory()->create([
            'organization_id' => $org->id,
            'full_name' => 'test-org/test-repo',
            'is_active' => true,
        ]);

        $existingRun = ReviewRun::factory()->running()->create([
            'repository_id' => $repo->id,
            'head_sha' => str_repeat('a', 40),
            'pr_number' => 42,
        ]);

        $this->mock(GitHubAppService::class, function (MockInterface $mock) {
            $mock->shouldReceive('getInstallationToken')->andReturn('ghs_test_token');
        });

        $this->mock(NatsService::class, function (MockInterface $mock) {
            $mock->shouldNotReceive('publish');
        });

        $this->dispatchJob($this->webhookPayload());

        $existingRun->refresh();
        $this->assertEquals(ReviewRunStatus::Running, $existingRun->status);
    }

    public function test_skips_processing_when_installation_id_missing(): void
    {
        $org = Organization::factory()->withCredits(5)->create(['login' => 'test-org']);
        Repository::factory()->create([
            'organization_id' => $org->id,
            'full_name' => 'test-org/test-repo',
            'is_active' => true,
        ]);

        $this->mock(NatsService::class, function (MockInterface $mock) {
            $mock->shouldNotReceive('publish');
        });

        $payload = $this->webhookPayload();
        unset($payload['installation']);

        $this->dispatchJob($payload);
    }

    public function test_deducts_credit_before_nats_dispatch(): void
    {
        $org = Organization::factory()->withCredits(10)->create(['login' => 'test-org']);
        Repository::factory()->create([
            'organization_id' => $org->id,
            'full_name' => 'test-org/test-repo',
            'is_active' => true,
        ]);

        $this->mock(GitHubAppService::class, function (MockInterface $mock) {
            $mock->shouldReceive('getInstallationToken')->andReturn('ghs_test_token');
        });

        $this->mock(NatsService::class, function (MockInterface $mock) {
            $mock->shouldReceive('publish')->once();
        });

        $this->dispatchJob($this->webhookPayload());

        $org->refresh();
        $this->assertEquals(9, $org->credit_balance);

        $this->assertDatabaseHas('credit_transactions', [
            'organization_id' => $org->id,
            'type' => 'deduction',
            'amount' => -1,
        ]);
    }

    public function test_skips_review_on_insufficient_credits(): void
    {
        $org = Organization::factory()->withCredits(0)->create(['login' => 'test-org']);
        $repo = Repository::factory()->create([
            'organization_id' => $org->id,
            'full_name' => 'test-org/test-repo',
            'is_active' => true,
        ]);

        $this->mock(GitHubAppService::class, function (MockInterface $mock) {
            $mock->shouldReceive('getInstallationToken')->andReturn('ghs_test_token');
        });

        $this->mock(NatsService::class, function (MockInterface $mock) {
            $mock->shouldNotReceive('publish');
        });

        $this->dispatchJob($this->webhookPayload());

        $this->assertDatabaseHas('review_runs', [
            'repository_id' => $repo->id,
            'pr_number' => 42,
            'status' => 'skipped',
        ]);

        $org->refresh();
        $this->assertEquals(0, $org->credit_balance);
    }

    public function test_byok_org_dispatches_without_credit_deduction(): void
    {
        $org = Organization::factory()->withCredits(0)->byok()->create(['login' => 'test-org']);
        $repo = Repository::factory()->create([
            'organization_id' => $org->id,
            'full_name' => 'test-org/test-repo',
            'is_active' => true,
        ]);

        $this->mock(GitHubAppService::class, function (MockInterface $mock) {
            $mock->shouldReceive('getInstallationToken')->andReturn('ghs_test_token');
        });

        $this->mock(NatsService::class, function (MockInterface $mock) {
            $mock->shouldReceive('publish')->once();
        });

        $this->dispatchJob($this->webhookPayload());

        $this->assertDatabaseHas('review_runs', [
            'repository_id' => $repo->id,
            'pr_number' => 42,
            'status' => 'pending',
        ]);

        // No credit transaction should be created
        $this->assertDatabaseMissing('credit_transactions', [
            'organization_id' => $org->id,
            'type' => 'deduction',
        ]);
    }

    private function dispatchJob(array $payload): void
    {
        $job = new ProcessPullRequestWebhook($payload);
        $job->handle(
            app(GitHubAppService::class),
            app(GitHubCheckService::class),
            app(RepoConfigService::class),
            app(NatsService::class),
            app(RunnerTokenService::class),
            app(CreditService::class),
        );
    }

    /**
     * @return array<string, mixed>
     */
    private function webhookPayload(): array
    {
        return [
            'action' => 'opened',
            'installation' => ['id' => 12345, 'account' => ['login' => 'test-org']],
            'repository' => ['full_name' => 'test-org/test-repo'],
            'pull_request' => [
                'number' => 42,
                'title' => 'Test PR',
                'body' => null,
                'head' => ['sha' => str_repeat('a', 40), 'ref' => 'feature/test'],
                'base' => ['sha' => str_repeat('b', 40), 'ref' => 'main'],
            ],
        ];
    }
}
