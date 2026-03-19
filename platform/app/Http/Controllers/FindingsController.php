<?php

namespace App\Http\Controllers;

use App\Services\FindingsService;
use Illuminate\Http\Request;
use Inertia\Inertia;
use Inertia\Response;

class FindingsController extends Controller
{
    public function __construct(private FindingsService $findingsService) {}

    public function index(Request $request): Response
    {
        $activeRepos = $request->user()
            ->organizations()
            ->with(['repositories' => fn ($q) => $q->active()->orderBy('full_name')])
            ->get()
            ->flatMap(fn ($org) => $org->repositories);

        $repoIds = $activeRepos->pluck('id');

        $filters = [
            'type' => $request->query('type'),
            'status' => $request->query('status', 'posted'),
            'resolution' => $request->query('resolution'),
            'repo' => $request->query('repo'),
            'range' => $request->query('range'),
        ];

        return Inertia::render('Findings', [
            'repositories' => $activeRepos->map(fn ($repo) => [
                'id' => $repo->id,
                'full_name' => $repo->full_name,
            ])->values()->all(),
            'filters' => $filters,
            'summary' => Inertia::defer(
                fn () => $this->findingsService->getSummary($repoIds, filters: $filters),
                'summary',
            ),
            'findings' => Inertia::defer(
                fn () => $this->findingsService->getPaginatedFindings($repoIds, filters: $filters),
                'findings',
            ),
        ]);
    }
}
