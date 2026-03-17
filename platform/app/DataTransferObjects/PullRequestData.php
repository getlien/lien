<?php

namespace App\DataTransferObjects;

class PullRequestData
{
    public function __construct(
        public readonly int $number,
        public readonly string $title,
        public readonly ?string $body,
        public readonly string $headSha,
        public readonly string $baseSha,
        public readonly ?string $headRef,
        public readonly ?string $baseRef,
    ) {}

    /**
     * @param  array<string, mixed>  $payload
     */
    public static function fromWebhookPayload(array $payload): self
    {
        $pr = $payload['pull_request'];

        return new self(
            number: $pr['number'],
            title: $pr['title'],
            body: $pr['body'] ?? null,
            headSha: $pr['head']['sha'],
            baseSha: $pr['base']['sha'],
            headRef: $pr['head']['ref'] ?? null,
            baseRef: $pr['base']['ref'] ?? null,
        );
    }

    /**
     * @return array{number: int, title: string, body: string|null, head_sha: string, base_sha: string, head_ref: string|null, base_ref: string|null}
     */
    public function toArray(): array
    {
        return [
            'number' => $this->number,
            'title' => $this->title,
            'body' => $this->body,
            'head_sha' => $this->headSha,
            'base_sha' => $this->baseSha,
            'head_ref' => $this->headRef,
            'base_ref' => $this->baseRef,
        ];
    }
}
