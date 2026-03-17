<?php

namespace App\Http\Controllers;

use App\Enums\ReviewRunStatus;
use App\Enums\ReviewRunType;
use App\Models\Repository;
use App\Models\ReviewRun;
use App\Services\RepositoryStatsService;
use Illuminate\Http\JsonResponse;
use Illuminate\Http\Request;
use Inertia\Inertia;
use Inertia\Response;

class ReviewRunController extends Controller
{
    public function index(Request $request, Repository $repository): Response
    {
        $this->authorize('view', $repository);
        $repository->load('organization');

        $view = $request->input('view', 'grouped');

        if ($view === 'grouped') {
            return $this->indexGrouped($request, $repository);
        }

        $query = $repository->reviewRuns()->latest('created_at');

        $type = ReviewRunType::tryFrom($request->input('type', ''));
        $status = ReviewRunStatus::tryFrom($request->input('status', ''));

        if ($type) {
            $query->where('type', $type);
        }

        if ($status) {
            $query->where('status', $status);
        }

        $runs = $query->paginate(15)->withQueryString()->through(fn ($run) => [
            'id' => $run->id,
            'type' => $run->type->value,
            'status' => $run->status->value,
            'pr_number' => $run->pr_number,
            'head_sha' => $run->head_sha ? substr($run->head_sha, 0, 7) : null,
            'files_analyzed' => $run->files_analyzed,
            'cost' => $run->cost !== null ? (float) $run->cost : null,
            'started_at' => $run->started_at?->toISOString(),
            'completed_at' => $run->completed_at?->toISOString(),
            'created_at' => $run->created_at->toISOString(),
            'duration_seconds' => $run->started_at && $run->completed_at
                ? $run->started_at->diffInSeconds($run->completed_at)
                : null,
        ]);

        return Inertia::render('Repositories/RunsList', [
            'repository' => $repository->only('id', 'full_name'),
            'organization' => $repository->organization->only('id', 'name', 'slug'),
            'runs' => $runs,
            'filters' => [
                'type' => $type?->value,
                'status' => $status?->value,
            ],
            'view' => 'all',
        ]);
    }

    private function indexGrouped(Request $request, Repository $repository): Response
    {
        $statsService = app(RepositoryStatsService::class);
        $page = max(1, $request->integer('page', 1));
        $prGroups = $statsService->getGroupedPrRuns($repository, $page);

        return Inertia::render('Repositories/RunsList', [
            'repository' => $repository->only('id', 'full_name'),
            'organization' => $repository->organization->only('id', 'name', 'slug'),
            'prGroups' => $prGroups,
            'filters' => [
                'type' => null,
                'status' => null,
            ],
            'view' => 'grouped',
        ]);
    }

    public function show(Repository $repository, ReviewRun $reviewRun): Response
    {
        $this->authorize('view', $repository);

        abort_unless($reviewRun->repository_id === $repository->id, 404);

        $repository->load('organization');

        return Inertia::render('Repositories/ReviewRun', [
            'repository' => $repository->only('id', 'full_name'),
            'organization' => $repository->organization->only('id', 'name', 'slug'),
            'reviewRun' => [
                'id' => $reviewRun->id,
                'type' => $reviewRun->type->value,
                'status' => $reviewRun->status->value,
                'pr_number' => $reviewRun->pr_number,
                'pr_title' => $reviewRun->pr_title,
                'head_sha' => $reviewRun->head_sha,
                'head_ref' => $reviewRun->head_ref,
                'base_sha' => $reviewRun->base_sha,
                'base_ref' => $reviewRun->base_ref,
                'started_at' => $reviewRun->started_at?->toISOString(),
                'completed_at' => $reviewRun->completed_at?->toISOString(),
                'created_at' => $reviewRun->created_at->toISOString(),
                'files_analyzed' => $reviewRun->files_analyzed,
                'token_usage' => $reviewRun->token_usage,
                'cost' => $reviewRun->cost,
                'avg_complexity' => $reviewRun->avg_complexity !== null ? (float) $reviewRun->avg_complexity : null,
                'max_complexity' => $reviewRun->max_complexity !== null ? (float) $reviewRun->max_complexity : null,
                'summary_comment_id' => $reviewRun->summary_comment_id,
                'github_check_run_id' => $reviewRun->github_check_run_id,
                'duration_seconds' => $reviewRun->started_at && $reviewRun->completed_at
                    ? $reviewRun->started_at->diffInSeconds($reviewRun->completed_at)
                    : null,
            ],

            'reviewComments' => Inertia::defer(
                fn () => $this->getReviewComments($reviewRun),
                'results',
            ),

            'complexitySnapshots' => Inertia::defer(
                fn () => $this->getComplexitySnapshots($reviewRun),
                'complexity',
            ),

            'deltaSummary' => Inertia::defer(
                fn () => $this->getDeltaSummary($reviewRun),
                'complexity',
            ),
        ]);
    }

    public function logs(Repository $repository, ReviewRun $reviewRun): JsonResponse
    {
        $this->authorize('view', $repository);

        abort_unless($reviewRun->repository_id === $repository->id, 404);

        $afterId = request()->integer('after', 0);

        $logs = $reviewRun->logs()
            ->where('id', '>', $afterId)
            ->orderBy('id')
            ->limit(200)
            ->get(['id', 'level', 'message', 'metadata', 'logged_at']);

        return response()->json([
            'logs' => $logs,
            'status' => $reviewRun->fresh()->status->value,
        ]);
    }

    /**
     * @return array<int, array<string, mixed>>
     */
    private function getReviewComments(ReviewRun $reviewRun): array
    {
        return $reviewRun->reviewComments()
            ->orderBy('filepath')
            ->orderBy('line')
            ->get(['id', 'review_type', 'filepath', 'line', 'symbol_name', 'body', 'status', 'github_comment_id', 'resolution'])
            ->toArray();
    }

    /**
     * @return array<int, array<string, mixed>>
     */
    private function getComplexitySnapshots(ReviewRun $reviewRun): array
    {
        return $reviewRun->complexitySnapshots()
            ->orderByRaw("CASE severity WHEN 'error' THEN 0 WHEN 'warning' THEN 1 WHEN 'info' THEN 2 ELSE 3 END")
            ->orderByRaw('ABS(COALESCE(delta_cyclomatic, 0)) DESC')
            ->orderBy('cyclomatic', 'desc')
            ->get([
                'id', 'filepath', 'symbol_name', 'symbol_type',
                'cyclomatic', 'cognitive', 'halstead_effort', 'halstead_bugs',
                'line_start', 'line_end',
                'delta_cyclomatic', 'delta_cognitive', 'severity',
            ])
            ->toArray();
    }

    /**
     * @return array{worsened: int, improved: int, unchanged: int, net_cyclomatic: int, net_cognitive: int, comments_posted: int}
     */
    private function getDeltaSummary(ReviewRun $reviewRun): array
    {
        $snapshots = $reviewRun->complexitySnapshots()
            ->select(['delta_cyclomatic', 'delta_cognitive'])
            ->get();

        $worsened = 0;
        $improved = 0;
        $unchanged = 0;
        $netCyclomatic = 0;
        $netCognitive = 0;

        foreach ($snapshots as $snapshot) {
            $delta = ($snapshot->delta_cyclomatic ?? 0) + ($snapshot->delta_cognitive ?? 0);
            if ($delta > 0) {
                $worsened++;
            } elseif ($delta < 0) {
                $improved++;
            } else {
                $unchanged++;
            }
            $netCyclomatic += $snapshot->delta_cyclomatic ?? 0;
            $netCognitive += $snapshot->delta_cognitive ?? 0;
        }

        $commentsPosted = $reviewRun->reviewComments()
            ->where('status', 'posted')
            ->count();

        return [
            'worsened' => $worsened,
            'improved' => $improved,
            'unchanged' => $unchanged,
            'net_cyclomatic' => $netCyclomatic,
            'net_cognitive' => $netCognitive,
            'comments_posted' => $commentsPosted,
        ];
    }
}
