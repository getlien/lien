<?php

namespace App\Http\Controllers\Concerns;

use Illuminate\Http\Request;
use Illuminate\Support\Collection;

trait WithActiveRepositories
{
    private const ALLOWED_RANGES = [7, 30, 90];

    /**
     * @return array{repos: Collection, repoIds: Collection<int, int>, repoList: list<array{id: int, full_name: string}>}
     */
    private function getActiveRepositories(Request $request): array
    {
        $repos = $request->user()
            ->organizations()
            ->with(['repositories' => fn ($q) => $q->active()->orderBy('full_name')])
            ->get()
            ->flatMap(fn ($org) => $org->repositories);

        return [
            'repos' => $repos,
            'repoIds' => $repos->pluck('id'),
            'repoList' => $repos->map(fn ($repo) => [
                'id' => $repo->id,
                'full_name' => $repo->full_name,
            ])->values()->all(),
        ];
    }

    private function resolveRange(Request $request, int $default = 30): int
    {
        $days = (int) $request->query('range', $default);

        return in_array($days, self::ALLOWED_RANGES, true) ? $days : $default;
    }
}
