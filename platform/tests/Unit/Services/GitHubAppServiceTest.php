<?php

namespace Tests\Unit\Services;

use App\Services\GitHubAppService;
use Firebase\JWT\JWT;
use Firebase\JWT\Key;
use PHPUnit\Framework\TestCase;

class GitHubAppServiceTest extends TestCase
{
    private string $privateKey = '';

    private string $publicKey = '';

    protected function setUp(): void
    {
        parent::setUp();

        $keyPair = openssl_pkey_new([
            'private_key_bits' => 2048,
            'private_key_type' => OPENSSL_KEYTYPE_RSA,
        ]);

        openssl_pkey_export($keyPair, $pem);
        $this->privateKey = $pem;
        $details = openssl_pkey_get_details($keyPair);
        $this->publicKey = $details['key'];
    }

    public function test_generate_jwt_produces_valid_rs256_token(): void
    {
        $service = new GitHubAppService(
            appId: '12345',
            privateKey: $this->privateKey,
        );

        $jwt = $service->generateJwt();

        $decoded = JWT::decode($jwt, new Key($this->publicKey, 'RS256'));

        $this->assertSame('12345', $decoded->iss);
        $this->assertLessThanOrEqual(time(), $decoded->iat);
        $this->assertGreaterThan(time(), $decoded->exp);
    }

    public function test_jwt_iat_is_backdated_60_seconds(): void
    {
        $service = new GitHubAppService(
            appId: '12345',
            privateKey: $this->privateKey,
        );

        $before = time() - 60;
        $jwt = $service->generateJwt();
        $decoded = JWT::decode($jwt, new Key($this->publicKey, 'RS256'));

        $this->assertGreaterThanOrEqual($before, $decoded->iat);
        $this->assertLessThanOrEqual(time() - 59, $decoded->iat);
    }

    public function test_jwt_expiry_is_10_minutes(): void
    {
        $service = new GitHubAppService(
            appId: '12345',
            privateKey: $this->privateKey,
        );

        $jwt = $service->generateJwt();
        $decoded = JWT::decode($jwt, new Key($this->publicKey, 'RS256'));

        $expectedExpiry = $decoded->iat + 60 + (10 * 60);
        $this->assertSame($expectedExpiry, $decoded->exp);
    }

    public function test_handles_escaped_newlines_in_pem_key(): void
    {
        $escapedKey = str_replace("\n", '\\n', $this->privateKey);

        $service = new GitHubAppService(
            appId: '12345',
            privateKey: $escapedKey,
        );

        $jwt = $service->generateJwt();
        $decoded = JWT::decode($jwt, new Key($this->publicKey, 'RS256'));

        $this->assertSame('12345', $decoded->iss);
    }
}
