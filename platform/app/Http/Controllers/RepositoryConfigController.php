<?php

namespace App\Http\Controllers;

use App\Http\Requests\UpdateRepoReviewConfigRequest;
use App\Models\Repository;
use App\Services\RepoConfigService;
use Illuminate\Http\RedirectResponse;
use Inertia\Inertia;
use Inertia\Response;

class RepositoryConfigController extends Controller
{
    public function __construct(private RepoConfigService $configService) {}

    public function show(Repository $repository): Response
    {
        $this->authorize('view', $repository);
        $repository->load('organization');

        return Inertia::render('Repositories/Config', [
            'repository' => $repository->only('id', 'full_name', 'review_config', 'is_active'),
            'organization' => $repository->organization->only('id', 'name', 'plan_tier'),
            'effectiveConfig' => $this->configService->getMergedConfig($repository),
        ]);
    }

    public function update(UpdateRepoReviewConfigRequest $request, Repository $repository): RedirectResponse
    {
        $this->authorize('update', $repository);
        $repository->update([
            'review_config' => $request->validated()['review_config'],
        ]);

        return redirect()->back();
    }

    public function destroy(Repository $repository): RedirectResponse
    {
        $this->authorize('update', $repository);
        $repository->update(['review_config' => []]);

        return redirect()->back();
    }
}
