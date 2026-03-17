<?php

namespace Tests\Unit\DataTransferObjects;

use App\DataTransferObjects\AuthData;
use App\DataTransferObjects\PullRequestData;
use App\DataTransferObjects\RepositoryData;
use App\DataTransferObjects\ReviewJobPayload;
use PHPUnit\Framework\TestCase;

class ReviewJobPayloadTest extends TestCase
{
    public function test_to_array_matches_expected_nats_payload_shape(): void
    {
        $payload = new ReviewJobPayload(
            jobType: 'pr',
            dispatchedAt: '2026-02-26T12:00:00+00:00',
            repository: new RepositoryData(
                id: 1,
                fullName: 'getlien/test-repo',
                defaultBranch: 'main',
            ),
            pullRequest: new PullRequestData(
                number: 42,
                title: 'Test PR',
                body: null,
                headSha: str_repeat('a', 40),
                baseSha: str_repeat('b', 40),
                headRef: 'feature/test',
                baseRef: 'main',
            ),
            config: [
                'threshold' => '15',
                'review_types' => [
                    'complexity' => true,
                    'architectural' => false,
                ],
                'block_on_new_errors' => false,
                'architectural_mode' => 'off',
            ],
            auth: new AuthData(
                installationToken: 'ghs_token',
                serviceToken: 'svc_token',
            ),
        );

        $array = $payload->toArray();

        $this->assertSame('pr', $array['job_type']);
        $this->assertSame('2026-02-26T12:00:00+00:00', $array['dispatched_at']);

        $this->assertSame(1, $array['repository']['id']);
        $this->assertSame('getlien/test-repo', $array['repository']['full_name']);
        $this->assertSame('main', $array['repository']['default_branch']);

        $this->assertSame(42, $array['pull_request']['number']);
        $this->assertSame(str_repeat('a', 40), $array['pull_request']['head_sha']);
        $this->assertSame(str_repeat('b', 40), $array['pull_request']['base_sha']);

        $this->assertSame('15', $array['config']['threshold']);
        $this->assertTrue($array['config']['review_types']['complexity']);

        $this->assertSame('ghs_token', $array['auth']['installation_token']);
        $this->assertSame('svc_token', $array['auth']['service_token']);
    }

    public function test_from_webhook_factory_builds_correct_payload(): void
    {
        $webhookPayload = [
            'pull_request' => [
                'number' => 7,
                'title' => 'Test PR',
                'body' => null,
                'head' => ['sha' => str_repeat('c', 40), 'ref' => 'feature/test'],
                'base' => ['sha' => str_repeat('d', 40), 'ref' => 'main'],
            ],
        ];

        $repository = new \App\Models\Repository;
        $repository->id = 99;
        $repository->full_name = 'org/repo';
        $repository->default_branch = 'develop';

        $config = [
            'threshold' => '15',
            'review_types' => ['complexity' => true, 'architectural' => false],
            'block_on_new_errors' => false,
            'architectural_mode' => 'off',
        ];

        $payload = ReviewJobPayload::fromWebhook(
            webhookPayload: $webhookPayload,
            repository: $repository,
            config: $config,
            installationToken: 'tok_install',
            serviceToken: 'tok_service',
        );

        $array = $payload->toArray();

        $this->assertSame('pr', $array['job_type']);
        $this->assertSame(99, $array['repository']['id']);
        $this->assertSame('org/repo', $array['repository']['full_name']);
        $this->assertSame(7, $array['pull_request']['number']);
        $this->assertSame('tok_install', $array['auth']['installation_token']);
    }
}
