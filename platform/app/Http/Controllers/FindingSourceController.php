<?php

namespace App\Http\Controllers;

use App\Models\ComplexitySnapshot;
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

        [$lineStart, $lineEnd] = $this->resolveLineRange($reviewRun->id, $reviewComment);

        $result = $this->fileService->fetchLines(
            $repository,
            (string) $reviewComment->filepath,
            $reviewRun->head_sha,
            $lineStart,
            $lineEnd,
        );

        $result['highlight_line'] = $reviewComment->line;

        $result['diff_lines'] = $reviewRun->pr_number
            ? $this->fileService->fetchAddedLines($repository, $reviewRun->pr_number, (string) $reviewComment->filepath)
            : [];

        return response()->json($result);
    }

    /**
     * @return array{0: int, 1: int|null}
     */
    private function resolveLineRange(int $reviewRunId, ReviewComment $comment): array
    {
        if ($comment->symbol_name) {
            $snapshot = ComplexitySnapshot::query()
                ->where('review_run_id', $reviewRunId)
                ->where('filepath', $comment->filepath)
                ->where('symbol_name', $comment->symbol_name)
                ->first();

            if ($snapshot && $snapshot->line_start) {
                return [
                    max(1, $snapshot->line_start - 1),
                    $snapshot->line_end ? $snapshot->line_end + 1 : null,
                ];
            }
        }

        return [
            $comment->line - self::CONTEXT_LINES,
            $comment->line + self::CONTEXT_LINES,
        ];
    }
}
