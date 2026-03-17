<?php

namespace App\DataTransferObjects;

use App\Models\Repository;

class ReviewJobPayload
{
    public function __construct(
        public readonly string $jobType,
        public readonly string $dispatchedAt,
        public readonly RepositoryData $repository,
        public readonly PullRequestData $pullRequest,
        /** @var array<string, mixed> */
        public readonly array $config,
        public readonly AuthData $auth,
        public readonly ?int $reviewRunId = null,
        public readonly ?int $checkRunId = null,
    ) {}

    /**
     * @param  array<string, mixed>  $webhookPayload
     * @param  array<string, mixed>  $config
     */
    public static function fromWebhook(
        array $webhookPayload,
        Repository $repository,
        array $config,
        string $installationToken,
        string $serviceToken,
        ?int $reviewRunId = null,
        ?int $checkRunId = null,
    ): self {
        return new self(
            jobType: 'pr',
            dispatchedAt: now()->toIso8601String(),
            repository: RepositoryData::fromModel($repository),
            pullRequest: PullRequestData::fromWebhookPayload($webhookPayload),
            config: $config,
            auth: new AuthData(
                installationToken: $installationToken,
                serviceToken: $serviceToken,
            ),
            reviewRunId: $reviewRunId,
            checkRunId: $checkRunId,
        );
    }

    /**
     * @return array{job_type: string, dispatched_at: string, repository: array<string, mixed>, pull_request: array<string, mixed>, config: array<string, mixed>, auth: array<string, mixed>, review_run_id: int|null, check_run_id: int|null}
     */
    public function toArray(): array
    {
        return [
            'job_type' => $this->jobType,
            'dispatched_at' => $this->dispatchedAt,
            'repository' => $this->repository->toArray(),
            'pull_request' => $this->pullRequest->toArray(),
            'config' => $this->config,
            'auth' => $this->auth->toArray(),
            'review_run_id' => $this->reviewRunId,
            'check_run_id' => $this->checkRunId,
        ];
    }
}
