<?php

namespace App\Http\Controllers;

use App\Http\Controllers\Concerns\WithActiveRepositories;
use App\Services\FindingsService;
use App\Services\RepositoryStatsService;
use Illuminate\Http\Request;
use Inertia\Inertia;
use Inertia\Response;

class DashboardController extends Controller
{
    use WithActiveRepositories;

    public function __construct(
        private FindingsService $findingsService,
        private RepositoryStatsService $statsService,
    ) {}

    public function show(Request $request): Response
    {
        ['repoIds' => $repoIds, 'repoList' => $repoList] = $this->getActiveRepositories($request);
        $days = $this->resolveRange($request);

        return Inertia::render('Dashboard', [
            'repositories' => $repoList,
            'range' => $days,
            'impactStats' => Inertia::defer(
                fn () => $this->findingsService->getImpactStats($repoIds, $days),
                'stats',
            ),
            'recentFindings' => Inertia::defer(
                fn () => $this->findingsService->getRecentFindings($repoIds, 10),
                'findings',
            ),
            'recentRuns' => Inertia::defer(
                fn () => $this->statsService->getCompactRecentRuns($repoIds, 5),
                'runs',
            ),
        ]);
    }
}
