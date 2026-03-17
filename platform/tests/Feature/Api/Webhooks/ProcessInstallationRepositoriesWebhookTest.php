<?php

namespace Tests\Feature\Api\Webhooks;

use App\Enums\ReviewRunStatus;
use App\Jobs\ProcessInstallationRepositoriesWebhook;
use App\Models\Organization;
use App\Models\Repository;
use App\Services\GitHubAppService;
use App\Services\NatsService;
use App\Services\RepoConfigService;
use App\Services\RunnerTokenService;
use Illuminate\Foundation\Testing\RefreshDatabase;
use Mockery\MockInterface;
use Tests\TestCase;

class ProcessInstallationRepositoriesWebhookTest extends TestCase
{
    use RefreshDatabase;

    protected function setUp(): void
    {
        parent::setUp();
        config(['services.lien.service_token' => 'test-signing-key-that-is-at-least-32-bytes-long']);
    }

    /**
     * @param  array<string, mixed>  $payload
     */
    private function dispatchWebhook(array $payload): void
    {
        $job = new ProcessInstallationRepositoriesWebhook($payload);
        $job->handle(
            app(GitHubAppService::class),
            app(RepoConfigService::class),
            app(NatsService::class),
            app(RunnerTokenService::class),
        );
    }

    /**
     * @param  list<array{sha: string, committed_at: string}>  $commits
     */
    private function mockAddedWorkflow(array $commits): void
    {
        $this->mock(GitHubAppService::class, function (MockInterface $mock) use ($commits) {
            $mock->shouldReceive('getInstallationToken')->once()->with(12345)->andReturn('ghs_test_token');
            $mock->shouldReceive('getRecentCommits')->once()->andReturn($commits);
        });

        $this->mock(NatsService::class, function (MockInterface $mock) {
            $mock->shouldReceive('publish');
        });
    }

    public function test_added_repos_dispatch_historical_baselines_to_nats(): void
    {
        $org = Organization::factory()->create(['login' => 'test-org']);
        Repository::factory()->create([
            'organization_id' => $org->id,
            'full_name' => 'test-org/repo-a',
            'default_branch' => 'main',
            'is_active' => true,
        ]);

        $commits = [
            ['sha' => 'aaaa', 'committed_at' => '2026-02-28T10:00:00Z'],
            ['sha' => 'bbbb', 'committed_at' => '2026-02-27T10:00:00Z'],
            ['sha' => 'cccc', 'committed_at' => '2026-02-26T10:00:00Z'],
        ];

        $this->mock(GitHubAppService::class, function (MockInterface $mock) use ($commits) {
            $mock->shouldReceive('getInstallationToken')->once()->with(12345)->andReturn('ghs_test_token');
            $mock->shouldReceive('getRecentCommits')->once()->andReturn($commits);
        });

        $tokenService = app(RunnerTokenService::class);
        $publishedPayloads = [];
        $this->mock(NatsService::class, function (MockInterface $mock) use (&$publishedPayloads) {
            $mock->shouldReceive('publish')
                ->withArgs(function (string $subject, array $payload) use (&$publishedPayloads) {
                    $publishedPayloads[] = $payload;

                    return $subject === 'reviews.baseline';
                });
        });

        $this->dispatchWebhook([
            'action' => 'added',
            'installation' => ['id' => 12345, 'account' => ['login' => 'test-org']],
            'repositories_added' => [
                ['full_name' => 'test-org/repo-a'],
                ['full_name' => 'test-org/unknown-repo'],
            ],
        ]);

        $this->assertCount(3, $publishedPayloads);
        $this->assertSame('aaaa', $publishedPayloads[0]['sha']);
        $this->assertSame('2026-02-28T10:00:00Z', $publishedPayloads[0]['committed_at']);
        $this->assertSame('bbbb', $publishedPayloads[1]['sha']);
        $this->assertSame('cccc', $publishedPayloads[2]['sha']);
        $this->assertSame('ghs_test_token', $publishedPayloads[0]['auth']['installation_token']);

        $claims = $tokenService->validate($publishedPayloads[0]['auth']['service_token']);
        $this->assertSame('runner', $claims->sub);
    }

    public function test_head_baselines_dispatched_before_historical(): void
    {
        $org = Organization::factory()->create(['login' => 'test-org']);
        Repository::factory()->create([
            'organization_id' => $org->id,
            'full_name' => 'test-org/repo-a',
            'default_branch' => 'main',
            'is_active' => true,
        ]);
        Repository::factory()->create([
            'organization_id' => $org->id,
            'full_name' => 'test-org/repo-b',
            'default_branch' => 'main',
            'is_active' => true,
        ]);

        $this->mock(GitHubAppService::class, function (MockInterface $mock) {
            $mock->shouldReceive('getInstallationToken')->once()->with(12345)->andReturn('ghs_test_token');
            $mock->shouldReceive('getRecentCommits')
                ->with('test-org/repo-a', 'main', 'ghs_test_token')
                ->andReturn([
                    ['sha' => 'a-head', 'committed_at' => '2026-02-28T10:00:00Z'],
                    ['sha' => 'a-old', 'committed_at' => '2026-02-27T10:00:00Z'],
                ]);
            $mock->shouldReceive('getRecentCommits')
                ->with('test-org/repo-b', 'main', 'ghs_test_token')
                ->andReturn([
                    ['sha' => 'b-head', 'committed_at' => '2026-02-28T09:00:00Z'],
                    ['sha' => 'b-old', 'committed_at' => '2026-02-27T09:00:00Z'],
                ]);
        });

        $publishedShas = [];
        $this->mock(NatsService::class, function (MockInterface $mock) use (&$publishedShas) {
            $mock->shouldReceive('publish')
                ->withArgs(function (string $subject, array $payload) use (&$publishedShas) {
                    $publishedShas[] = $payload['sha'];

                    return $subject === 'reviews.baseline';
                });
        });

        $this->dispatchWebhook([
            'action' => 'added',
            'installation' => ['id' => 12345, 'account' => ['login' => 'test-org']],
            'repositories_added' => [
                ['full_name' => 'test-org/repo-a'],
                ['full_name' => 'test-org/repo-b'],
            ],
        ]);

        $this->assertSame(['a-head', 'b-head', 'a-old', 'b-old'], $publishedShas);
    }

    public function test_falls_back_to_branch_baseline_when_commits_fetch_fails(): void
    {
        $org = Organization::factory()->create(['login' => 'test-org']);
        Repository::factory()->create([
            'organization_id' => $org->id,
            'full_name' => 'test-org/empty-repo',
            'default_branch' => 'main',
            'is_active' => true,
        ]);

        $this->mock(GitHubAppService::class, function (MockInterface $mock) {
            $mock->shouldReceive('getInstallationToken')->once()->andReturn('ghs_test_token');
            $mock->shouldReceive('getRecentCommits')->once()
                ->andThrow(new \RuntimeException('Git Repository is empty'));
        });

        $this->mock(NatsService::class, function (MockInterface $mock) {
            $mock->shouldReceive('publish')
                ->once()
                ->withArgs(fn (string $subject, array $payload) => $subject === 'reviews.baseline'
                    && $payload['job_type'] === 'baseline'
                    && ! isset($payload['sha'])
                    && ! isset($payload['committed_at']));
        });

        $this->dispatchWebhook([
            'action' => 'added',
            'installation' => ['id' => 12345, 'account' => ['login' => 'test-org']],
            'repositories_added' => [['full_name' => 'test-org/empty-repo']],
        ]);
    }

    public function test_removed_repos_are_deactivated(): void
    {
        $org = Organization::factory()->create(['login' => 'test-org']);
        $repo = Repository::factory()->create([
            'organization_id' => $org->id,
            'full_name' => 'test-org/repo-b',
            'is_active' => true,
        ]);

        $this->dispatchWebhook([
            'action' => 'removed',
            'installation' => ['id' => 12345, 'account' => ['login' => 'test-org']],
            'repositories_removed' => [['full_name' => 'test-org/repo-b']],
        ]);

        $this->assertDatabaseHas('repositories', [
            'id' => $repo->id,
            'is_active' => false,
        ]);
    }

    public function test_stores_installation_id_on_organization(): void
    {
        $org = Organization::factory()->create([
            'login' => 'test-org',
            'github_installation_id' => null,
        ]);

        $this->dispatchWebhook([
            'action' => 'removed',
            'installation' => ['id' => 99999, 'account' => ['login' => 'test-org']],
            'repositories_removed' => [],
        ]);

        $this->assertDatabaseHas('organizations', [
            'id' => $org->id,
            'github_installation_id' => 99999,
        ]);
    }

    public function test_creates_pending_review_runs_when_dispatching_baselines(): void
    {
        $org = Organization::factory()->create(['login' => 'test-org']);
        $repo = Repository::factory()->create([
            'organization_id' => $org->id,
            'full_name' => 'test-org/repo-a',
            'default_branch' => 'main',
            'is_active' => true,
        ]);

        $this->mockAddedWorkflow([
            ['sha' => 'aaaa', 'committed_at' => '2026-02-28T10:00:00Z'],
            ['sha' => 'bbbb', 'committed_at' => '2026-02-27T10:00:00Z'],
        ]);

        $this->dispatchWebhook([
            'action' => 'added',
            'installation' => ['id' => 12345, 'account' => ['login' => 'test-org']],
            'repositories_added' => [['full_name' => 'test-org/repo-a']],
        ]);

        $this->assertDatabaseCount('review_runs', 2);
        $this->assertDatabaseHas('review_runs', [
            'repository_id' => $repo->id,
            'head_sha' => 'aaaa',
            'pr_number' => null,
            'status' => ReviewRunStatus::Pending->value,
        ]);
        $this->assertDatabaseHas('review_runs', [
            'repository_id' => $repo->id,
            'head_sha' => 'bbbb',
            'pr_number' => null,
            'status' => ReviewRunStatus::Pending->value,
        ]);
    }

    public function test_creates_pending_review_run_for_branch_fallback(): void
    {
        $org = Organization::factory()->create(['login' => 'test-org']);
        $repo = Repository::factory()->create([
            'organization_id' => $org->id,
            'full_name' => 'test-org/empty-repo',
            'default_branch' => 'main',
            'is_active' => true,
        ]);

        $this->mock(GitHubAppService::class, function (MockInterface $mock) {
            $mock->shouldReceive('getInstallationToken')->once()->andReturn('ghs_test_token');
            $mock->shouldReceive('getRecentCommits')->once()->andThrow(new \RuntimeException('Empty'));
        });

        $this->mock(NatsService::class, function (MockInterface $mock) {
            $mock->shouldReceive('publish')->once();
        });

        $this->dispatchWebhook([
            'action' => 'added',
            'installation' => ['id' => 12345, 'account' => ['login' => 'test-org']],
            'repositories_added' => [['full_name' => 'test-org/empty-repo']],
        ]);

        $this->assertDatabaseCount('review_runs', 1);
        $this->assertDatabaseHas('review_runs', [
            'repository_id' => $repo->id,
            'head_sha' => null,
            'pr_number' => null,
            'status' => ReviewRunStatus::Pending->value,
        ]);
    }

    public function test_does_not_create_duplicate_pending_runs_on_retry(): void
    {
        $org = Organization::factory()->create(['login' => 'test-org']);
        Repository::factory()->create([
            'organization_id' => $org->id,
            'full_name' => 'test-org/repo-a',
            'default_branch' => 'main',
            'is_active' => true,
        ]);

        $this->mock(GitHubAppService::class, function (MockInterface $mock) {
            $mock->shouldReceive('getInstallationToken')->andReturn('ghs_test_token');
            $mock->shouldReceive('getRecentCommits')->andReturn([
                ['sha' => 'aaaa', 'committed_at' => '2026-02-28T10:00:00Z'],
            ]);
        });

        $this->mock(NatsService::class, function (MockInterface $mock) {
            $mock->shouldReceive('publish');
        });

        $payload = [
            'action' => 'added',
            'installation' => ['id' => 12345, 'account' => ['login' => 'test-org']],
            'repositories_added' => [['full_name' => 'test-org/repo-a']],
        ];

        $this->dispatchWebhook($payload);
        $this->dispatchWebhook($payload);

        $this->assertDatabaseCount('review_runs', 1);
    }

    public function test_overwrites_existing_installation_id(): void
    {
        $org = Organization::factory()->create([
            'login' => 'test-org',
            'github_installation_id' => 11111,
        ]);

        $this->dispatchWebhook([
            'action' => 'removed',
            'installation' => ['id' => 99999, 'account' => ['login' => 'test-org']],
            'repositories_removed' => [],
        ]);

        $this->assertDatabaseHas('organizations', [
            'id' => $org->id,
            'github_installation_id' => 99999,
        ]);
    }
}
