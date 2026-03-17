<?php

namespace Tests\Unit\DataTransferObjects;

use App\DataTransferObjects\AuthData;
use App\DataTransferObjects\BaselineJobPayload;
use App\DataTransferObjects\RepositoryData;
use PHPUnit\Framework\TestCase;

class BaselineJobPayloadTest extends TestCase
{
    public function test_to_array_excludes_sha_and_committed_at_when_null(): void
    {
        $payload = new BaselineJobPayload(
            jobType: 'baseline',
            dispatchedAt: '2026-02-28T10:00:00+00:00',
            repository: new RepositoryData(id: 1, fullName: 'org/repo', defaultBranch: 'main'),
            config: ['threshold' => '15'],
            auth: new AuthData(installationToken: 'tok', serviceToken: 'svc'),
        );

        $array = $payload->toArray();

        $this->assertArrayNotHasKey('sha', $array);
        $this->assertArrayNotHasKey('committed_at', $array);
        $this->assertSame('baseline', $array['job_type']);
    }

    public function test_to_array_includes_sha_and_committed_at_when_set(): void
    {
        $payload = new BaselineJobPayload(
            jobType: 'baseline',
            dispatchedAt: '2026-02-28T10:00:00+00:00',
            repository: new RepositoryData(id: 1, fullName: 'org/repo', defaultBranch: 'main'),
            config: ['threshold' => '15'],
            auth: new AuthData(installationToken: 'tok', serviceToken: 'svc'),
            sha: 'abc123',
            committedAt: '2026-02-27T09:00:00Z',
        );

        $array = $payload->toArray();

        $this->assertSame('abc123', $array['sha']);
        $this->assertSame('2026-02-27T09:00:00Z', $array['committed_at']);
    }

    public function test_from_commit_factory_sets_sha_and_committed_at(): void
    {
        $repository = new \App\Models\Repository;
        $repository->id = 5;
        $repository->full_name = 'org/repo';
        $repository->default_branch = 'main';

        $payload = BaselineJobPayload::fromCommit(
            repository: $repository,
            sha: str_repeat('a', 40),
            committedAt: '2026-02-28T10:00:00Z',
            config: ['threshold' => '15'],
            installationToken: 'tok_install',
            serviceToken: 'tok_service',
        );

        $array = $payload->toArray();

        $this->assertSame('baseline', $array['job_type']);
        $this->assertSame(str_repeat('a', 40), $array['sha']);
        $this->assertSame('2026-02-28T10:00:00Z', $array['committed_at']);
        $this->assertSame(5, $array['repository']['id']);
        $this->assertSame('tok_install', $array['auth']['installation_token']);
    }

    public function test_from_repository_factory_has_no_sha(): void
    {
        $repository = new \App\Models\Repository;
        $repository->id = 5;
        $repository->full_name = 'org/repo';
        $repository->default_branch = 'main';

        $payload = BaselineJobPayload::fromRepository(
            repository: $repository,
            config: ['threshold' => '15'],
            installationToken: 'tok_install',
            serviceToken: 'tok_service',
        );

        $array = $payload->toArray();

        $this->assertArrayNotHasKey('sha', $array);
        $this->assertArrayNotHasKey('committed_at', $array);
    }
}
