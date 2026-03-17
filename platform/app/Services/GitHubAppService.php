<?php

namespace App\Services;

use Firebase\JWT\JWT;
use Illuminate\Support\Facades\Cache;
use Illuminate\Support\Facades\Http;
use RuntimeException;

class GitHubAppService
{
    public function __construct(
        private readonly string $appId,
        private readonly string $privateKey,
    ) {}

    /**
     * Generate an RS256 JWT for GitHub App authentication.
     *
     * The JWT is backdated 60 seconds to account for clock drift
     * and has a 10-minute expiry per GitHub's requirements.
     */
    public function generateJwt(): string
    {
        $now = time();

        $payload = [
            'iat' => $now - 60,
            'exp' => $now + (10 * 60),
            'iss' => $this->appId,
        ];

        return JWT::encode($payload, $this->normalizePrivateKey(), 'RS256');
    }

    /**
     * Get an installation access token, cached for 55 minutes.
     *
     * GitHub installation tokens expire after 60 minutes.
     * We cache for 55 minutes to provide a 5-minute buffer.
     */
    public function getInstallationToken(int $installationId): string
    {
        $cacheKey = "github:installation_token:{$installationId}";

        return Cache::remember($cacheKey, 55 * 60, function () use ($installationId) {
            $jwt = $this->generateJwt();

            $response = Http::withToken($jwt)
                ->acceptJson()
                ->post("https://api.github.com/app/installations/{$installationId}/access_tokens");

            if (! $response->successful()) {
                throw new RuntimeException(
                    "Failed to get installation token for installation {$installationId}: {$response->body()}"
                );
            }

            return $response->json('token');
        });
    }

    /**
     * Get recent commits for a repository branch.
     *
     * @return array<int, array{sha: string, committed_at: string}>
     */
    public function getRecentCommits(string $repoFullName, string $branch, string $token, int $count = 5): array
    {
        $response = Http::withToken($token)
            ->acceptJson()
            ->timeout(10)
            ->get("https://api.github.com/repos/{$repoFullName}/commits", [
                'sha' => $branch,
                'per_page' => $count,
            ]);

        if (! $response->successful()) {
            throw new RuntimeException(
                "Failed to get commits for {$repoFullName}: {$response->body()}"
            );
        }

        return collect($response->json())
            ->map(fn (array $commit) => [
                'sha' => $commit['sha'],
                'committed_at' => $commit['commit']['committer']['date'],
            ])
            ->all();
    }

    /**
     * Normalize the PEM private key to handle both literal newlines and escaped \n.
     */
    private function normalizePrivateKey(): string
    {
        $key = $this->privateKey;

        if (str_contains($key, '\\n')) {
            $key = str_replace('\\n', "\n", $key);
        }

        return $key;
    }
}
