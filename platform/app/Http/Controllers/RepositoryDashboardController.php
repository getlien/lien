<?php

namespace App\Http\Controllers;

use App\Enums\ReviewRunStatus;
use App\Models\Repository;
use App\Services\RepositoryStatsService;
use Illuminate\Http\Request;
use Inertia\Inertia;
use Inertia\Response;

class RepositoryDashboardController extends Controller
{
    private const ALLOWED_RANGES = [7, 30, 90];

    public function __construct(private RepositoryStatsService $stats) {}

    public function show(Request $request, Repository $repository): Response
    {
        $this->authorize('view', $repository);
        $repository->load('organization');

        $days = (int) $request->query('range', 30);
        if (! in_array($days, self::ALLOWED_RANGES, true)) {
            $days = 30;
        }

        $lastRun = $repository->reviewRuns()
            ->where('status', ReviewRunStatus::Completed)
            ->latest('completed_at')
            ->first();

        $pendingBaselines = $repository->reviewRuns()
            ->baseline()
            ->whereIn('status', [ReviewRunStatus::Pending, ReviewRunStatus::Running])
            ->count();

        $completedBaselines = $repository->reviewRuns()
            ->baseline()
            ->where('status', ReviewRunStatus::Completed)
            ->count();

        return Inertia::render('Repositories/Dashboard', [
            'repository' => $repository->only('id', 'full_name', 'is_active'),
            'organization' => $repository->organization->only('id', 'name', 'slug'),
            'lastReviewDate' => $lastRun?->completed_at?->toISOString(),
            'totalRuns' => $repository->reviewRuns()->where('status', ReviewRunStatus::Completed)->count(),
            'baselineProgress' => [
                'pending' => $pendingBaselines,
                'completed' => $completedBaselines,
                'total' => $pendingBaselines + $completedBaselines,
                'is_generating' => $pendingBaselines > 0,
            ],

            'trendData' => Inertia::defer(fn () => $this->stats->getTrendData($repository), 'charts'),
            'topFunctions' => Inertia::defer(fn () => $this->stats->getTopFunctions($repository), 'charts'),
            'clusterMapData' => Inertia::defer(fn () => $this->stats->getClusterMapData($repository), 'charts'),

            'recentRuns' => Inertia::defer(fn () => $this->stats->getRecentRuns($repository), 'runs'),

            'range' => $days,

            'reviewActivity' => Inertia::defer(fn () => $this->stats->getReviewActivity($repository, $days), 'stats'),
            'costTracking' => Inertia::defer(fn () => $this->stats->getCostTracking($repository, $days), 'stats'),
        ]);
    }
}
