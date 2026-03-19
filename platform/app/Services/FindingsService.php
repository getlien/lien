<?php

namespace App\Services;

use App\Enums\ReviewCommentStatus;
use App\Enums\ReviewRunStatus;
use App\Enums\ReviewRunType;
use App\Models\ReviewComment;
use App\Models\ReviewRun;
use Illuminate\Database\Eloquent\Builder;
use Illuminate\Pagination\LengthAwarePaginator;
use Illuminate\Support\Collection;

class FindingsService
{
    /**
     * @param  Collection<int, int>  $repoIds
     * @return array{prsReviewed: int, findingsPosted: int, byType: array<string, int>, resolutionRate: int, totalCost: float}
     */
    public function getImpactStats(Collection $repoIds, int $days = 30): array
    {
        $since = now()->subDays($days);

        $prsReviewed = (int) ReviewRun::whereIn('repository_id', $repoIds)
            ->where('type', ReviewRunType::Pr)
            ->where('status', ReviewRunStatus::Completed)
            ->where('completed_at', '>=', $since)
            ->distinct('pr_number')
            ->count('pr_number');

        $completedRunIds = ReviewRun::whereIn('repository_id', $repoIds)
            ->where('status', ReviewRunStatus::Completed)
            ->where('completed_at', '>=', $since)
            ->pluck('id');

        if ($completedRunIds->isEmpty()) {
            return [
                'prsReviewed' => $prsReviewed,
                'findingsPosted' => 0,
                'byType' => [],
                'resolutionRate' => 0,
                'totalCost' => 0.0,
            ];
        }

        $findingsQuery = ReviewComment::whereIn('review_run_id', $completedRunIds)
            ->where('status', ReviewCommentStatus::Posted);

        $findingsPosted = (clone $findingsQuery)->count();

        $byType = (clone $findingsQuery)
            ->selectRaw('review_type, COUNT(*) as count')
            ->groupBy('review_type')
            ->pluck('count', 'review_type')
            ->all();

        $resolutionRate = $findingsPosted > 0
            ? (int) round((clone $findingsQuery)->whereNotNull('resolution')->count() / $findingsPosted * 100)
            : 0;

        $totalCost = (float) ReviewRun::whereIn('repository_id', $repoIds)
            ->where('status', ReviewRunStatus::Completed)
            ->where('completed_at', '>=', $since)
            ->sum('cost');

        return [
            'prsReviewed' => $prsReviewed,
            'findingsPosted' => $findingsPosted,
            'byType' => $byType,
            'resolutionRate' => $resolutionRate,
            'totalCost' => $totalCost,
        ];
    }

    /**
     * @param  Collection<int, int>  $repoIds
     * @return list<array<string, mixed>>
     */
    public function getRecentFindings(Collection $repoIds, int $limit = 10): array
    {
        return ReviewComment::query()
            ->where('review_comments.status', ReviewCommentStatus::Posted)
            ->whereHas('reviewRun', fn (Builder $q) => $q
                ->whereIn('repository_id', $repoIds)
                ->where('status', ReviewRunStatus::Completed)
            )
            ->with(['reviewRun:id,repository_id,pr_number,pr_title', 'reviewRun.repository:id,full_name'])
            ->latest('review_comments.created_at')
            ->limit($limit)
            ->get()
            ->map(fn (ReviewComment $comment) => $this->formatFinding($comment))
            ->all();
    }

    /**
     * @param  Collection<int, int>  $repoIds
     * @return list<array<string, mixed>>
     */
    public function getCompactRecentRuns(Collection $repoIds, int $limit = 5): array
    {
        return ReviewRun::with('repository:id,full_name')
            ->whereIn('repository_id', $repoIds)
            ->latest('created_at')
            ->limit($limit)
            ->get()
            ->map(fn (ReviewRun $run) => [
                'id' => $run->id,
                'repository_id' => $run->repository_id,
                'repository_name' => $run->repository->full_name,
                'type' => $run->type->value,
                'status' => $run->status->value,
                'pr_number' => $run->pr_number,
                'pr_title' => $run->pr_title,
                'created_at' => $run->created_at->toISOString(),
            ])
            ->all();
    }

    /**
     * @param  Collection<int, int>|null  $repoIds
     * @param  array{type?: string, status?: string, resolution?: string, repo?: string, range?: string}  $filters
     * @return array{posted: int, resolved: int, dismissed: int, open: int}
     */
    public function getSummary(
        ?Collection $repoIds = null,
        ?int $repositoryId = null,
        array $filters = [],
    ): array {
        $base = $this->baseFindingsQuery($repoIds, $repositoryId, $filters);

        $posted = (clone $base)->count();
        $resolved = (clone $base)->where('review_comments.resolution', 'resolved')->count();
        $dismissed = (clone $base)->where('review_comments.resolution', 'dismissed')->count();
        $open = (clone $base)->whereNull('review_comments.resolution')->count();

        return [
            'posted' => $posted,
            'resolved' => $resolved,
            'dismissed' => $dismissed,
            'open' => $open,
        ];
    }

    /**
     * @param  Collection<int, int>|null  $repoIds
     * @param  array{type?: string, status?: string, resolution?: string, repo?: string, range?: string}  $filters
     */
    public function getPaginatedFindings(
        ?Collection $repoIds = null,
        ?int $repositoryId = null,
        array $filters = [],
        int $perPage = 25,
    ): LengthAwarePaginator {
        $query = $this->baseFindingsQuery($repoIds, $repositoryId, $filters)
            ->with(['reviewRun:id,repository_id,pr_number,pr_title', 'reviewRun.repository:id,full_name'])
            ->latest('review_comments.created_at');

        return $query->paginate($perPage)
            ->withQueryString()
            ->through(fn (ReviewComment $comment) => $this->formatFinding($comment));
    }

    /**
     * @param  Collection<int, int>|null  $repoIds
     * @param  array{type?: string, status?: string, resolution?: string, repo?: string, range?: string}  $filters
     */
    private function baseFindingsQuery(
        ?Collection $repoIds,
        ?int $repositoryId,
        array $filters = [],
    ): Builder {
        $query = ReviewComment::query()
            ->join('review_runs', 'review_comments.review_run_id', '=', 'review_runs.id')
            ->where('review_runs.status', ReviewRunStatus::Completed->value)
            ->select('review_comments.*');

        if ($repositoryId) {
            $query->where('review_runs.repository_id', $repositoryId);
        } elseif ($repoIds) {
            $query->whereIn('review_runs.repository_id', $repoIds);
        }

        $status = $filters['status'] ?? 'posted';
        if ($status !== 'all') {
            $query->where('review_comments.status', $status);
        }

        if (! empty($filters['type'])) {
            $query->where('review_comments.review_type', $filters['type']);
        }

        if (! empty($filters['resolution'])) {
            if ($filters['resolution'] === 'open') {
                $query->whereNull('review_comments.resolution');
            } else {
                $query->where('review_comments.resolution', $filters['resolution']);
            }
        }

        if (! empty($filters['repo'])) {
            $query->where('review_runs.repository_id', (int) $filters['repo']);
        }

        if (! empty($filters['range']) && $filters['range'] !== 'all') {
            $days = (int) $filters['range'];
            $query->where('review_runs.completed_at', '>=', now()->subDays($days));
        }

        return $query;
    }

    /**
     * @return array<string, mixed>
     */
    private function formatFinding(ReviewComment $comment): array
    {
        return [
            'id' => $comment->id,
            'review_type' => $comment->review_type,
            'filepath' => $comment->filepath,
            'line' => $comment->line,
            'symbol_name' => $comment->symbol_name,
            'body' => $comment->body,
            'status' => $comment->status->value,
            'resolution' => $comment->resolution?->value,
            'created_at' => $comment->created_at->toISOString(),
            'pr_number' => $comment->reviewRun?->pr_number,
            'pr_title' => $comment->reviewRun?->pr_title,
            'repository_id' => $comment->reviewRun?->repository_id,
            'repository_name' => $comment->reviewRun?->repository?->full_name,
        ];
    }
}
