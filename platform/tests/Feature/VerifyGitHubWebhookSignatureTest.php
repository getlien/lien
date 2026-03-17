<?php

namespace Tests\Feature;

use Illuminate\Foundation\Testing\RefreshDatabase;
use Tests\TestCase;
use Tests\Traits\WithWebhookSignature;

class VerifyGitHubWebhookSignatureTest extends TestCase
{
    use RefreshDatabase;
    use WithWebhookSignature;

    protected function setUp(): void
    {
        parent::setUp();
        $this->setUpWebhookSecret();
    }

    public function test_valid_signature_passes(): void
    {
        $payload = ['action' => 'completed'];
        $body = json_encode($payload);

        $response = $this->postJson(
            '/api/webhooks/github',
            $payload,
            $this->webhookHeaders($body, 'check_suite'),
        );

        $response->assertOk();
    }

    public function test_invalid_signature_returns_403(): void
    {
        $response = $this->postJson(
            '/api/webhooks/github',
            ['action' => 'completed'],
            [
                'X-GitHub-Event' => 'check_suite',
                'X-Hub-Signature-256' => 'sha256=wrong',
            ],
        );

        $response->assertForbidden();
        $response->assertJson(['message' => 'Forbidden.']);
    }

    public function test_missing_signature_returns_403(): void
    {
        $response = $this->postJson(
            '/api/webhooks/github',
            ['action' => 'completed'],
            ['X-GitHub-Event' => 'check_suite'],
        );

        $response->assertForbidden();
    }

    public function test_missing_webhook_secret_config_returns_403(): void
    {
        config(['services.github_app.webhook_secret' => null]);

        $response = $this->postJson(
            '/api/webhooks/github',
            ['action' => 'completed'],
            [
                'X-GitHub-Event' => 'check_suite',
                'X-Hub-Signature-256' => 'sha256=something',
            ],
        );

        $response->assertForbidden();
    }
}
