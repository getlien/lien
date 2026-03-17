<?php

namespace Tests\Traits;

trait WithWebhookSignature
{
    protected string $webhookSecret = 'test-webhook-secret';

    protected function setUpWebhookSecret(): void
    {
        config(['services.github_app.webhook_secret' => $this->webhookSecret]);
    }

    /**
     * @return array<string, string>
     */
    protected function webhookHeaders(string $body, string $event): array
    {
        $signature = 'sha256='.hash_hmac('sha256', $body, $this->webhookSecret);

        return [
            'X-GitHub-Event' => $event,
            'X-Hub-Signature-256' => $signature,
        ];
    }
}
