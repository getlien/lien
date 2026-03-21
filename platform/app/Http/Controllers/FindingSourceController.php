<?php

namespace App\Http\Controllers;

use App\Models\Repository;
use App\Models\ReviewComment;
use App\Services\GitHubFileService;
use Illuminate\Http\JsonResponse;

class FindingSourceController extends Controller
{
    private const CONTEXT_LINES = 10;

    public function __construct(private GitHubFileService $fileService) {}

    public function show(Repository $repository, ReviewComment $reviewComment): JsonResponse
    {
        $this->authorize('view', $repository);

        $reviewRun = $reviewComment->reviewRun;

        if (! $reviewRun || $reviewRun->repository_id !== $repository->id) {
            abort(404);
        }

        if (! $reviewComment->filepath || ! $reviewComment->line) {
            return response()->json(['error' => 'Finding has no file location.'], 422);
        }

        if (! $reviewRun->head_sha) {
            return response()->json(['error' => 'No commit SHA available for this review run.'], 422);
        }

        $result = $this->fileService->fetchLines(
            $repository,
            (string) $reviewComment->filepath,
            $reviewRun->head_sha,
            $reviewComment->line - self::CONTEXT_LINES,
            $reviewComment->line + self::CONTEXT_LINES,
        );

        $result['highlight_line'] = $reviewComment->line;

        return response()->json($result);
    }
}
