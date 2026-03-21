<?php

namespace App\Http\Controllers;

use App\Models\ComplexitySnapshot;
use App\Models\Repository;
use App\Services\GitHubFileService;
use Illuminate\Http\JsonResponse;

class FunctionSourceController extends Controller
{
    public function __construct(private GitHubFileService $fileService) {}

    public function show(Repository $repository, ComplexitySnapshot $complexitySnapshot): JsonResponse
    {
        $this->authorize('view', $repository);

        if ($complexitySnapshot->repository_id !== $repository->id) {
            abort(404);
        }

        $reviewRun = $complexitySnapshot->reviewRun;

        if (! $reviewRun->head_sha) {
            return response()->json(['error' => 'No commit SHA available for this review run.'], 422);
        }

        $result = $this->fileService->fetchLines(
            $repository,
            $complexitySnapshot->filepath,
            $reviewRun->head_sha,
            max(1, $complexitySnapshot->line_start),
            $complexitySnapshot->line_end,
        );

        return response()->json($result);
    }
}
