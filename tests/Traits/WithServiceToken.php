<?php

namespace Tests\Traits;

use App\Services\RunnerTokenService;

trait WithServiceToken
{
    protected function setUpServiceToken(): void
    {
        config(['services.lien.service_token' => 'test-signing-key-that-is-at-least-32-bytes-long']);
    }

    /**
     * @return array<string, string>
     */
    protected function serviceTokenHeaders(int $repositoryId = 1, ?int $reviewRunId = null): array
    {
        $tokenService = new RunnerTokenService('test-signing-key-that-is-at-least-32-bytes-long');

        return [
            'Authorization' => 'Bearer '.$tokenService->mint($repositoryId, $reviewRunId),
        ];
    }
}
