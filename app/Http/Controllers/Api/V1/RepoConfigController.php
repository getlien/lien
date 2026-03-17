<?php

namespace App\Http\Controllers\Api\V1;

use App\Http\Controllers\Controller;
use App\Http\Requests\Api\V1\ShowRepoConfigRequest;
use App\Http\Requests\Api\V1\UpdateRepoConfigRequest;
use App\Models\Repository;
use App\Services\RepoConfigService;
use Illuminate\Http\JsonResponse;

class RepoConfigController extends Controller
{
    public function __construct(private RepoConfigService $configService) {}

    public function show(ShowRepoConfigRequest $request, Repository $repository): JsonResponse
    {
        return response()->json(
            $this->configService->getMergedConfig($repository),
        );
    }

    public function update(UpdateRepoConfigRequest $request, Repository $repository): JsonResponse
    {
        $validated = $request->validated();

        $repository->update([
            'review_config' => $validated['review_config'],
        ]);

        return response()->json(
            $this->configService->getMergedConfig($repository->fresh()),
        );
    }
}
