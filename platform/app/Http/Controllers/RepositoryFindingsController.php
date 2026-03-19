<?php

namespace App\Http\Controllers;

use App\Models\Repository;
use App\Services\FindingsService;
use Illuminate\Http\Request;
use Inertia\Inertia;
use Inertia\Response;

class RepositoryFindingsController extends Controller
{
    public function __construct(private FindingsService $findingsService) {}

    public function index(Request $request, Repository $repository): Response
    {
        $this->authorize('view', $repository);
        $repository->load('organization');

        $filters = [
            'type' => $request->query('type'),
            'status' => $request->query('status', 'posted'),
            'resolution' => $request->query('resolution'),
            'range' => $request->query('range'),
        ];

        return Inertia::render('Repositories/Findings', [
            'repository' => $repository->only('id', 'full_name', 'is_active'),
            'organization' => $repository->organization->only('id', 'name', 'slug'),
            'filters' => $filters,
            'summary' => Inertia::defer(
                fn () => $this->findingsService->getSummary(repositoryId: $repository->id, filters: $filters),
                'summary',
            ),
            'findings' => Inertia::defer(
                fn () => $this->findingsService->getPaginatedFindings(repositoryId: $repository->id, filters: $filters),
                'findings',
            ),
        ]);
    }
}
