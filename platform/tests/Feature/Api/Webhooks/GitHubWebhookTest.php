<?php

namespace Tests\Feature\Api\Webhooks;

use App\Jobs\ProcessInstallationRepositoriesWebhook;
use App\Jobs\ProcessPullRequestWebhook;
use Illuminate\Foundation\Testing\RefreshDatabase;
use Illuminate\Support\Facades\Queue;
use Tests\TestCase;
use Tests\Traits\WithWebhookSignature;

class GitHubWebhookTest extends TestCase
{
    use RefreshDatabase;
    use WithWebhookSignature;

    protected function setUp(): void
    {
        parent::setUp();
        $this->setUpWebhookSecret();
        Queue::fake();
    }

    public function test_pull_request_opened_dispatches_job(): void
    {
        $payload = $this->pullRequestPayload('opened');
        $body = json_encode($payload);

        $response = $this->postJson(
            '/api/webhooks/github',
            $payload,
            $this->webhookHeaders($body, 'pull_request'),
        );

        $response->assertOk();
        $response->assertJson(['status' => 'queued', 'event' => 'pull_request', 'action' => 'opened']);
        Queue::assertPushed(ProcessPullRequestWebhook::class);
    }

    public function test_pull_request_synchronize_dispatches_job(): void
    {
        $payload = $this->pullRequestPayload('synchronize');
        $body = json_encode($payload);

        $response = $this->postJson(
            '/api/webhooks/github',
            $payload,
            $this->webhookHeaders($body, 'pull_request'),
        );

        $response->assertOk();
        $response->assertJson(['status' => 'queued', 'action' => 'synchronize']);
        Queue::assertPushed(ProcessPullRequestWebhook::class);
    }

    public function test_pull_request_closed_is_ignored(): void
    {
        $payload = $this->pullRequestPayload('closed');
        $body = json_encode($payload);

        $response = $this->postJson(
            '/api/webhooks/github',
            $payload,
            $this->webhookHeaders($body, 'pull_request'),
        );

        $response->assertOk();
        $response->assertJson(['status' => 'ignored', 'action' => 'closed']);
        Queue::assertNotPushed(ProcessPullRequestWebhook::class);
    }

    public function test_installation_repositories_dispatches_job(): void
    {
        $payload = ['action' => 'added', 'installation' => ['id' => 123, 'account' => ['login' => 'test-org']], 'repositories_added' => []];
        $body = json_encode($payload);

        $response = $this->postJson(
            '/api/webhooks/github',
            $payload,
            $this->webhookHeaders($body, 'installation_repositories'),
        );

        $response->assertOk();
        $response->assertJson(['status' => 'queued', 'event' => 'installation_repositories']);
        Queue::assertPushed(ProcessInstallationRepositoriesWebhook::class);
    }

    public function test_installation_deleted_is_logged_not_queued(): void
    {
        $payload = ['action' => 'deleted', 'installation' => ['id' => 123, 'account' => ['login' => 'test-org']]];
        $body = json_encode($payload);

        $response = $this->postJson(
            '/api/webhooks/github',
            $payload,
            $this->webhookHeaders($body, 'installation'),
        );

        $response->assertOk();
        $response->assertJson(['status' => 'ignored', 'event' => 'installation']);
        Queue::assertNothingPushed();
    }

    public function test_unknown_event_returns_200_with_ignored(): void
    {
        $payload = ['action' => 'completed'];
        $body = json_encode($payload);

        $response = $this->postJson(
            '/api/webhooks/github',
            $payload,
            $this->webhookHeaders($body, 'check_suite'),
        );

        $response->assertOk();
        $response->assertJson(['status' => 'ignored', 'event' => 'check_suite']);
        Queue::assertNothingPushed();
    }

    public function test_invalid_signature_returns_403(): void
    {
        $response = $this->postJson(
            '/api/webhooks/github',
            ['action' => 'opened'],
            [
                'X-GitHub-Event' => 'pull_request',
                'X-Hub-Signature-256' => 'sha256=invalidsignature',
            ],
        );

        $response->assertForbidden();
    }

    public function test_missing_signature_returns_403(): void
    {
        $response = $this->postJson(
            '/api/webhooks/github',
            ['action' => 'opened'],
            ['X-GitHub-Event' => 'pull_request'],
        );

        $response->assertForbidden();
    }

    /**
     * @return array<string, mixed>
     */
    private function pullRequestPayload(string $action): array
    {
        return [
            'action' => $action,
            'installation' => ['id' => 12345, 'account' => ['login' => 'test-org']],
            'repository' => ['full_name' => 'test-org/test-repo'],
            'pull_request' => [
                'number' => 42,
                'head' => ['sha' => str_repeat('a', 40)],
                'base' => ['sha' => str_repeat('b', 40)],
            ],
        ];
    }
}
