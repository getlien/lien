<?php

namespace Tests\Feature;

use App\Models\Repository;
use App\Services\RunnerTokenService;
use Firebase\JWT\JWT;
use Illuminate\Foundation\Testing\RefreshDatabase;
use Tests\TestCase;

class AuthenticateRunnerTokenTest extends TestCase
{
    use RefreshDatabase;

    private const SIGNING_KEY = 'test-signing-key-that-is-at-least-32-bytes-long';

    protected function setUp(): void
    {
        parent::setUp();
        config(['services.lien.service_token' => self::SIGNING_KEY]);
    }

    public function test_valid_jwt_passes(): void
    {
        $repo = Repository::factory()->create();
        $tokenService = new RunnerTokenService(self::SIGNING_KEY);
        $jwt = $tokenService->mint($repo->id);

        $response = $this->getJson("/api/v1/repos/{$repo->id}/config", [
            'Authorization' => "Bearer {$jwt}",
        ]);

        $response->assertOk();
    }

    public function test_expired_jwt_returns_401(): void
    {
        $repo = Repository::factory()->create();

        $claims = [
            'iss' => 'lien-platform',
            'sub' => 'runner',
            'repo' => $repo->id,
            'rid' => null,
            'iat' => time() - 3600,
            'exp' => time() - 1800,
            'jti' => 'expired-token',
        ];

        $jwt = JWT::encode($claims, self::SIGNING_KEY, 'HS256');

        $response = $this->getJson("/api/v1/repos/{$repo->id}/config", [
            'Authorization' => "Bearer {$jwt}",
        ]);

        $response->assertUnauthorized();
    }

    public function test_tampered_signature_returns_401(): void
    {
        $repo = Repository::factory()->create();
        $tokenService = new RunnerTokenService(self::SIGNING_KEY);
        $jwt = $tokenService->mint($repo->id);

        $parts = explode('.', $jwt);
        $parts[2] = strtr(base64_encode('tampered'), '+/', '-_');
        $tamperedJwt = implode('.', $parts);

        $response = $this->getJson("/api/v1/repos/{$repo->id}/config", [
            'Authorization' => "Bearer {$tamperedJwt}",
        ]);

        $response->assertUnauthorized();
    }

    public function test_missing_token_returns_401(): void
    {
        $repo = Repository::factory()->create();

        $response = $this->getJson("/api/v1/repos/{$repo->id}/config");

        $response->assertUnauthorized();
        $response->assertJson(['message' => 'Unauthenticated.']);
    }

    public function test_wrong_signing_key_returns_401(): void
    {
        $repo = Repository::factory()->create();
        $tokenService = new RunnerTokenService('wrong-key-that-is-also-at-least-32-bytes-long');
        $jwt = $tokenService->mint($repo->id);

        $response = $this->getJson("/api/v1/repos/{$repo->id}/config", [
            'Authorization' => "Bearer {$jwt}",
        ]);

        $response->assertUnauthorized();
    }
}
