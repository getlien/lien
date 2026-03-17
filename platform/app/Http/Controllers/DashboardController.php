<?php

namespace App\Http\Controllers;

use App\Services\DashboardService;
use Illuminate\Http\Request;
use Illuminate\Support\Collection;
use Inertia\Inertia;
use Inertia\Response;

class DashboardController extends Controller
{
    public function __construct(private DashboardService $dashboardService) {}

    public function show(Request $request): Response
    {
        $view = in_array($request->query('view'), ['by_pr', 'all']) ? $request->query('view') : 'by_pr';

        $activeRepos = $request->user()
            ->organizations()
            ->with(['repositories' => fn ($q) => $q->active()->orderBy('full_name')])
            ->get()
            ->flatMap(fn ($org) => $org->repositories);

        $repoIds = $activeRepos->pluck('id');
        $repoFilter = $this->resolveRepoFilter($request->query('repo'), $repoIds);

        $filters = [
            'type' => $request->query('type'),
            'status' => $request->query('status'),
            'repo' => $repoFilter,
        ];

        $page = max(1, (int) $request->query('page', 1));

        $props = [
            'view' => $view,
            'filters' => $filters,
            'repositories' => $activeRepos->map(fn ($repo) => [
                'id' => $repo->id,
                'full_name' => $repo->full_name,
            ])->values()->all(),
            ...$this->getDeferredData($view, $repoIds, $filters, $page),
        ];

        return Inertia::render('Dashboard', $props);
    }

    private function resolveRepoFilter(?string $value, Collection $repoIds): ?int
    {
        $repoFilter = $value ? (int) $value : null;

        return ($repoFilter && $repoIds->contains($repoFilter)) ? $repoFilter : null;
    }

    /**
     * @param  Collection<int, int>  $repoIds
     * @param  array{type: ?string, status: ?string, repo: ?int}  $filters
     * @return array<string, mixed>
     */
    private function getDeferredData(string $view, Collection $repoIds, array $filters, int $page): array
    {
        if ($view === 'all') {
            return [
                'allRuns' => Inertia::defer(fn () => $this->dashboardService->getAllRuns(
                    $repoIds,
                    $filters['type'],
                    $filters['status'],
                    $filters['repo'],
                ), 'runs'),
            ];
        }

        return [
            'groupedRuns' => Inertia::defer(fn () => $this->dashboardService->getGroupedByPr(
                $repoIds,
                $filters['status'],
                $filters['repo'],
                page: $page,
            ), 'runs'),
        ];
    }
}
