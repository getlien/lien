<?php

namespace App\DataTransferObjects;

use App\Models\Repository;

class RepositoryData
{
    public function __construct(
        public readonly int $id,
        public readonly string $fullName,
        public readonly string $defaultBranch,
    ) {}

    public static function fromModel(Repository $repository): self
    {
        return new self(
            id: $repository->id,
            fullName: $repository->full_name,
            defaultBranch: $repository->default_branch,
        );
    }

    /**
     * @return array{id: int, full_name: string, default_branch: string}
     */
    public function toArray(): array
    {
        return [
            'id' => $this->id,
            'full_name' => $this->fullName,
            'default_branch' => $this->defaultBranch,
        ];
    }
}
