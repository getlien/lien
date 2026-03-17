<?php

namespace App\DataTransferObjects;

class BaselineJobPayload
{
    public function __construct(
        public readonly string $jobType,
        public readonly string $dispatchedAt,
        public readonly RepositoryData $repository,
        /** @var array<string, mixed> */
        public readonly array $config,
        public readonly AuthData $auth,
        public readonly ?string $sha = null,
        public readonly ?string $committedAt = null,
    ) {}

    /**
     * @param  array<string, mixed>  $config
     */
    public static function fromRepository(
        \App\Models\Repository $repository,
        array $config,
        string $installationToken,
        string $serviceToken,
    ): self {
        return new self(
            jobType: 'baseline',
            dispatchedAt: now()->toIso8601String(),
            repository: RepositoryData::fromModel($repository),
            config: $config,
            auth: new AuthData(
                installationToken: $installationToken,
                serviceToken: $serviceToken,
            ),
        );
    }

    /**
     * @param  array<string, mixed>  $config
     */
    public static function fromCommit(
        \App\Models\Repository $repository,
        string $sha,
        string $committedAt,
        array $config,
        string $installationToken,
        string $serviceToken,
    ): self {
        return new self(
            jobType: 'baseline',
            dispatchedAt: now()->toIso8601String(),
            repository: RepositoryData::fromModel($repository),
            config: $config,
            auth: new AuthData(
                installationToken: $installationToken,
                serviceToken: $serviceToken,
            ),
            sha: $sha,
            committedAt: $committedAt,
        );
    }

    /**
     * @return array<string, mixed>
     */
    public function toArray(): array
    {
        $data = [
            'job_type' => $this->jobType,
            'dispatched_at' => $this->dispatchedAt,
            'repository' => $this->repository->toArray(),
            'config' => $this->config,
            'auth' => $this->auth->toArray(),
        ];

        if ($this->sha !== null) {
            $data['sha'] = $this->sha;
        }

        if ($this->committedAt !== null) {
            $data['committed_at'] = $this->committedAt;
        }

        return $data;
    }
}
