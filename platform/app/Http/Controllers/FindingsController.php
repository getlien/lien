<?php

namespace App\Http\Controllers;

use App\Http\Controllers\Concerns\WithActiveRepositories;
use App\Services\FindingsService;
use Illuminate\Http\Request;
use Inertia\Inertia;
use Inertia\Response;

class FindingsController extends Controller
{
    use WithActiveRepositories;

    public function __construct(private FindingsService $findingsService) {}

    public function index(Request $request): Response
    {
        ['repoIds' => $repoIds, 'repoList' => $repoList] = $this->getActiveRepositories($request);

        $filters = [
            'type' => $request->query('type'),
            'status' => $request->query('status', 'posted'),
            'resolution' => $request->query('resolution'),
            'repo' => $request->query('repo'),
            'range' => $request->query('range'),
        ];

        return Inertia::render('Findings', [
            'repositories' => $repoList,
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
