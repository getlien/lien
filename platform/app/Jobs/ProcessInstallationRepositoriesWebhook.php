<?php

namespace App\Jobs;

use App\DataTransferObjects\BaselineJobPayload;
use App\Enums\ReviewRunStatus;
use App\Enums\ReviewRunType;
use App\Models\Organization;
use App\Models\Repository;
use App\Models\ReviewRun;
use App\Services\GitHubAppService;
use App\Services\NatsService;
use App\Services\RepoConfigService;
use App\Services\RunnerTokenService;
use Illuminate\Contracts\Queue\ShouldQueue;
use Illuminate\Foundation\Queue\Queueable;
use Illuminate\Support\Collection;
use Illuminate\Support\Facades\Log;
use Illuminate\Support\Str;

class ProcessInstallationRepositoriesWebhook implements ShouldQueue
{
    use Queueable;

    public int $tries = 3;

    public int $backoff = 10;

    /**
     * @param  array<string, mixed>  $payload
     */
    public function __construct(
        public readonly array $payload,
    ) {}

    public function handle(
        GitHubAppService $gitHubApp,
        RepoConfigService $configService,
        NatsService $nats,
        RunnerTokenService $tokenService,
    ): void {
        $action = $this->payload['action'] ?? null;
        $installationId = $this->payload['installation']['id'] ?? null;

        $this->storeInstallationId($installationId);

        if ($action === 'added' && $installationId === null) {
            Log::warning('Missing installation ID for added repositories');

            return;
        }

        match ($action) {
            'added' => $this->handleAdded($gitHubApp, $configService, $nats, $tokenService, $installationId),
            'removed' => $this->handleRemoved(),
            default => Log::info('Ignoring installation_repositories action', ['action' => $action]),
        };
    }

    private function handleAdded(
        GitHubAppService $gitHubApp,
        RepoConfigService $configService,
        NatsService $nats,
        RunnerTokenService $tokenService,
        int $installationId,
    ): void {
        $activeRepos = $this->findActiveRepositories();

        if ($activeRepos->isEmpty()) {
            return;
        }

        $token = $gitHubApp->getInstallationToken($installationId);

        $repoData = $this->resolveCommits($activeRepos, $gitHubApp, $configService, $nats, $tokenService, $token);
        $this->dispatchHeadBaselines($repoData, $nats, $tokenService, $token);
        $this->dispatchHistoricalBaselines($repoData, $nats, $tokenService, $token);
    }

    /**
     * @return Collection<int, Repository>
     */
    private function findActiveRepositories(): Collection
    {
        $addedNames = collect($this->payload['repositories_added'] ?? [])
            ->pluck('full_name');

        return Repository::query()
            ->with('organization')
            ->whereIn('full_name', $addedNames)
            ->active()
            ->get();
    }

    /**
     * Fetch recent commits for each repository. Falls back to branch-based baseline on failure.
     *
     * @param  Collection<int, Repository>  $repositories
     * @return Collection<int, array{repository: Repository, config: array<string, mixed>, commits: list<array{sha: string, committed_at: string}>}>
     */
    private function resolveCommits(
        Collection $repositories,
        GitHubAppService $gitHubApp,
        RepoConfigService $configService,
        NatsService $nats,
        RunnerTokenService $tokenService,
        string $token,
    ): Collection {
        return $repositories->map(function (Repository $repository) use ($gitHubApp, $configService, $nats, $tokenService, $token) {
            $config = $configService->getRunnerConfig($repository);

            try {
                $commits = $gitHubApp->getRecentCommits(
                    $repository->full_name,
                    $repository->default_branch,
                    $token,
                );
            } catch (\Throwable $e) {
                Log::warning('Failed to fetch recent commits, falling back to branch-based baseline', [
                    'repo' => $repository->full_name,
                    'error' => $e->getMessage(),
                ]);

                $payload = BaselineJobPayload::fromRepository($repository, $config, $token, $tokenService->mint($repository->id));
                $nats->publish('reviews.baseline', $payload->toArray());
                $this->createPendingReviewRun($repository, null, null);
                Log::info('Dispatched baseline review to NATS', ['repo' => $repository->full_name]);

                return null;
            }

            return compact('repository', 'config', 'commits');
        })->filter();
    }

    /**
     * @param  Collection<int, array{repository: Repository, config: array<string, mixed>, commits: list<array{sha: string, committed_at: string}>}>  $repoData
     */
    private function dispatchHeadBaselines(Collection $repoData, NatsService $nats, RunnerTokenService $tokenService, string $token): void
    {
        $repoData->each(function (array $entry) use ($nats, $tokenService, $token) {
            if (empty($entry['commits'])) {
                return;
            }

            $this->dispatchCommitBaseline($entry['repository'], $entry['commits'][0], $entry['config'], $nats, $tokenService, $token, 'HEAD');
        });
    }

    /**
     * @param  Collection<int, array{repository: Repository, config: array<string, mixed>, commits: list<array{sha: string, committed_at: string}>}>  $repoData
     */
    private function dispatchHistoricalBaselines(Collection $repoData, NatsService $nats, RunnerTokenService $tokenService, string $token): void
    {
        $repoData->each(function (array $entry) use ($nats, $tokenService, $token) {
            collect($entry['commits'])->skip(1)->each(function (array $commit) use ($entry, $nats, $tokenService, $token) {
                $this->dispatchCommitBaseline($entry['repository'], $commit, $entry['config'], $nats, $tokenService, $token, 'historical');
            });
        });
    }

    /**
     * @param  array{sha: string, committed_at: string}  $commit
     * @param  array<string, mixed>  $config
     */
    private function dispatchCommitBaseline(
        Repository $repository,
        array $commit,
        array $config,
        NatsService $nats,
        RunnerTokenService $tokenService,
        string $token,
        string $label,
    ): void {
        $payload = BaselineJobPayload::fromCommit(
            repository: $repository,
            sha: $commit['sha'],
            committedAt: $commit['committed_at'],
            config: $config,
            installationToken: $token,
            serviceToken: $tokenService->mint($repository->id),
        );

        $nats->publish('reviews.baseline', $payload->toArray());
        $this->createPendingReviewRun($repository, $commit['sha'], $commit['committed_at']);
        Log::info("Dispatched {$label} baseline to NATS", [
            'repo' => $repository->full_name,
            'sha' => $commit['sha'],
        ]);
    }

    private function handleRemoved(): void
    {
        $repos = $this->payload['repositories_removed'] ?? [];

        foreach ($repos as $repo) {
            $updated = Repository::query()
                ->where('full_name', $repo['full_name'])
                ->update(['is_active' => false]);

            if ($updated) {
                Log::info('Deactivated repository', ['full_name' => $repo['full_name']]);
            }
        }
    }

    private function createPendingReviewRun(Repository $repository, ?string $sha, ?string $committedAt): void
    {
        ReviewRun::firstOrCreate(
            [
                'repository_id' => $repository->id,
                'head_sha' => $sha,
                'pr_number' => null,
            ],
            [
                'type' => ReviewRunType::Baseline,
                'idempotency_key' => Str::random(64),
                'committed_at' => $committedAt,
                'status' => ReviewRunStatus::Pending,
                'files_analyzed' => 0,
                'token_usage' => 0,
                'cost' => 0,
            ],
        );
    }

    private function storeInstallationId(?int $installationId): void
    {
        if (! $installationId) {
            return;
        }

        $login = $this->payload['installation']['account']['login'] ?? null;

        if (! $login) {
            return;
        }

        Organization::query()
            ->where('login', $login)
            ->update(['github_installation_id' => $installationId]);
    }
}
