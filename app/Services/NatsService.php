<?php

namespace App\Services;

use Basis\Nats\Client;
use Basis\Nats\Configuration;
use Basis\Nats\Stream\Stream;
use RuntimeException;

class NatsService
{
    private ?Client $client = null;

    private ?Stream $stream = null;

    public function __construct(
        private readonly string $host,
        private readonly int $port,
        private readonly string $streamName = 'reviews',
    ) {}

    /**
     * Publish a JSON payload to the given NATS subject via JetStream.
     *
     * Uses JetStream publish (request/reply) to get an ack from the server,
     * ensuring the message is persisted. Core NATS publish is fire-and-forget
     * and silently drops messages on stale connections.
     *
     * @param  array<string, mixed>  $payload
     */
    public function publish(string $subject, array $payload): void
    {
        $encoded = json_encode($payload, JSON_THROW_ON_ERROR);

        try {
            $this->stream()->publish($subject, $encoded);
        } catch (\Throwable) {
            // Connection likely went stale — reconnect and retry once.
            $this->disconnect();

            try {
                $this->stream()->publish($subject, $encoded);
            } catch (\Throwable $e) {
                throw new RuntimeException("Failed to publish to NATS subject '$subject': {$e->getMessage()}", 0, $e);
            }
        }
    }

    public function disconnect(): void
    {
        $this->stream = null;
        $this->client?->disconnect();
        $this->client = null;
    }

    public function __destruct()
    {
        $this->disconnect();
    }

    private function stream(): Stream
    {
        if ($this->stream === null) {
            $this->stream = $this->client()->getApi()->getStream($this->streamName);
        }

        return $this->stream;
    }

    private function client(): Client
    {
        if ($this->client === null) {
            $this->client = new Client(new Configuration(
                host: $this->host,
                port: $this->port,
            ));
        }

        return $this->client;
    }
}
