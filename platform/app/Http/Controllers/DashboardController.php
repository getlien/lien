<?php

namespace App\Http\Controllers;

use App\Services\FindingsService;
use Illuminate\Http\Request;
use Inertia\Inertia;
use Inertia\Response;

class DashboardController extends Controller
{
    private const ALLOWED_RANGES = [7, 30, 90];

    public function __construct(private FindingsService $findingsService) {}

    public function show(Request $request): Response
    {
        $activeRepos = $request->user()
            ->organizations()
            ->with(['repositories' => fn ($q) => $q->active()->orderBy('full_name')])
            ->get()
            ->flatMap(fn ($org) => $org->repositories);

        $repoIds = $activeRepos->pluck('id');

        $days = (int) $request->query('range', 30);
        if (! in_array($days, self::ALLOWED_RANGES, true)) {
            $days = 30;
        }

        return Inertia::render('Dashboard', [
            'repositories' => $activeRepos->map(fn ($repo) => [
                'id' => $repo->id,
                'full_name' => $repo->full_name,
            ])->values()->all(),
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
                fn () => $this->findingsService->getCompactRecentRuns($repoIds, 5),
                'runs',
            ),
        ]);
    }
}
