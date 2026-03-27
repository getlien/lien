<?php

namespace App\Jobs;

use App\DataTransferObjects\ReviewJobPayload;
use App\Enums\ReviewRunStatus;
use App\Enums\ReviewRunType;
use App\Models\Organization;
use App\Models\Repository;
use App\Models\ReviewRun;
use App\Services\GitHubAppService;
use App\Services\GitHubCheckService;
use App\Services\NatsService;
use App\Services\RepoConfigService;
use App\Services\RunnerTokenService;
use Illuminate\Contracts\Queue\ShouldQueue;
use Illuminate\Foundation\Queue\Queueable;
use Illuminate\Support\Facades\Log;

class ProcessPullRequestWebhook implements ShouldQueue
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
        GitHubCheckService $checkService,
        RepoConfigService $configService,
        NatsService $nats,
        RunnerTokenService $tokenService,
    ): void {
        $fullName = $this->payload['repository']['full_name'] ?? null;
        $installationId = $this->payload['installation']['id'] ?? null;

        $repository = Repository::query()
            ->where('full_name', $fullName)
            ->active()
            ->first();

        if (! $repository) {
            Log::info('Ignoring PR webhook for unknown or inactive repo', ['full_name' => $fullName]);

            return;
        }

        if (! $installationId) {
            Log::warning('Missing installation ID in PR webhook payload', ['full_name' => $fullName]);

            return;
        }

        $repository->organization()
            ->update(['github_installation_id' => $installationId]);

        $org = $repository->organization;
        $token = $gitHubApp->getInstallationToken($installationId);

        $reviewRun = $this->findOrCreateReviewRun($repository, $fullName);

        if (! $reviewRun) {
            return;
        }

        if (! $reviewRun->github_check_run_id) {
            $checkRunId = $checkService->createCheckRun($reviewRun, $token);

            if ($checkRunId) {
                $reviewRun->update(['github_check_run_id' => $checkRunId]);
            }
        }

        if (! $this->hasCredits($org, $reviewRun, $checkService, $token)) {
            return;
        }

        $this->dispatchToNats($repository, $reviewRun, $configService, $nats, $tokenService, $token);
    }

    private function findOrCreateReviewRun(Repository $repository, ?string $fullName): ?ReviewRun
    {
        $pr = $this->payload['pull_request'];
        $headSha = $pr['head']['sha'];
        $prNumber = $pr['number'];

        $reviewRun = ReviewRun::firstOrCreate(
            [
                'repository_id' => $repository->id,
                'head_sha' => $headSha,
                'pr_number' => $prNumber,
            ],
            [
                'type' => ReviewRunType::Pr,
                'pr_title' => $pr['title'] ?? null,
                'base_sha' => $pr['base']['sha'],
                'head_ref' => $pr['head']['ref'] ?? null,
                'base_ref' => $pr['base']['ref'] ?? null,
                'idempotency_key' => "pr-{$repository->id}-{$headSha}-{$prNumber}",
                'status' => ReviewRunStatus::Pending,
            ],
        );

        if (! $reviewRun->wasRecentlyCreated) {
            Log::info('Review run already exists, skipping duplicate dispatch', [
                'repo' => $fullName,
                'pr' => $prNumber,
                'review_run_id' => $reviewRun->id,
                'status' => $reviewRun->status->value,
            ]);

            return null;
        }

        return $reviewRun;
    }

    private function hasCredits(
        Organization $org,
        ReviewRun $reviewRun,
        GitHubCheckService $checkService,
        string $token,
    ): bool {
        if ($org->canRunReview()) {
            return true;
        }

        Log::info('Insufficient credits, skipping review', [
            'repo' => $reviewRun->repository->full_name,
            'pr' => $reviewRun->pr_number,
            'organization_id' => $org->id,
        ]);

        $reviewRun->update(['status' => ReviewRunStatus::Skipped]);

        if ($reviewRun->github_check_run_id) {
            $checkService->completeCheckRun(
                reviewRun: $reviewRun,
                checkRunId: $reviewRun->github_check_run_id,
                installationToken: $token,
                conclusion: 'neutral',
                title: 'No credits remaining',
                summary: 'This review was skipped because your organization has no credits remaining. [Purchase credits](https://lien.dev/billing) to continue receiving AI-powered reviews.',
            );
        }

        return false;
    }

    private function dispatchToNats(
        Repository $repository,
        ReviewRun $reviewRun,
        RepoConfigService $configService,
        NatsService $nats,
        RunnerTokenService $tokenService,
        string $token,
    ): void {
        $config = $configService->getRunnerConfig($repository);

        $payload = ReviewJobPayload::fromWebhook(
            webhookPayload: $this->payload,
            repository: $repository,
            config: $config,
            installationToken: $token,
            serviceToken: $tokenService->mint($repository->id, $reviewRun->id),
            reviewRunId: $reviewRun->id,
            checkRunId: $reviewRun->github_check_run_id,
        );

        $nats->publish('reviews.pr', $payload->toArray());

        Log::info('Dispatched PR review to NATS', [
            'repo' => $repository->full_name,
            'pr' => $reviewRun->pr_number,
            'review_run_id' => $reviewRun->id,
            'check_run_id' => $reviewRun->github_check_run_id,
        ]);
    }
}
