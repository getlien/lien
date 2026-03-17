<?php

namespace App\DataTransferObjects;

class AuthData
{
    public function __construct(
        public readonly string $installationToken,
        public readonly string $serviceToken,
    ) {}

    /**
     * @return array{installation_token: string, service_token: string}
     */
    public function toArray(): array
    {
        return [
            'installation_token' => $this->installationToken,
            'service_token' => $this->serviceToken,
        ];
    }
}
