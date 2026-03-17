<?php

namespace App\Services;

use Firebase\JWT\JWT;
use Firebase\JWT\Key;
use Illuminate\Support\Str;

class RunnerTokenService
{
    private const ALGORITHM = 'HS256';

    private const TTL_SECONDS = 1800; // 30 minutes

    public function __construct(private readonly string $signingKey) {}

    public function mint(int $repositoryId, ?int $reviewRunId = null): string
    {
        $now = time();

        $claims = [
            'iss' => 'lien-platform',
            'sub' => 'runner',
            'repo' => $repositoryId,
            'rid' => $reviewRunId,
            'iat' => $now,
            'exp' => $now + self::TTL_SECONDS,
            'jti' => Str::random(16),
        ];

        return JWT::encode($claims, $this->signingKey, self::ALGORITHM);
    }

    public function validate(string $token): object
    {
        $decoded = JWT::decode($token, new Key($this->signingKey, self::ALGORITHM));

        if (($decoded->iss ?? null) !== 'lien-platform' || ($decoded->sub ?? null) !== 'runner') {
            throw new \UnexpectedValueException('Invalid token issuer or subject.');
        }

        return $decoded;
    }
}
