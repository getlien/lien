<?php

namespace App\Services;

use App\Enums\ReviewCommentStatus;
use App\Enums\ReviewRunStatus;
use App\Enums\ReviewRunType;
use App\Models\Repository;

class RepositoryStatsService
{
    /**
     * @return list<array{date: string, type: string, pr_number: int|null, avg_complexity: float|null, max_complexity: float|null}>
     */
    public function getTrendData(Repository $repository): array
    {
        return $repository->reviewRuns()
            ->where('status', ReviewRunStatus::Completed)
            ->where(fn ($q) => $q->whereNotNull('committed_at')->orWhereNotNull('completed_at'))
            ->orderByRaw('COALESCE(committed_at, completed_at) ASC')
            ->limit(100)
            ->get(['type', 'committed_at', 'completed_at', 'pr_number', 'avg_complexity', 'max_complexity'])
            ->map(fn ($run) => [
                'date' => ($run->committed_at ?? $run->completed_at)->toDateString(),
                'type' => $run->type->value,
                'pr_number' => $run->pr_number,
                'avg_complexity' => $run->avg_complexity !== null ? (float) $run->avg_complexity : null,
                'max_complexity' => $run->max_complexity !== null ? (float) $run->max_complexity : null,
            ])
            ->values()
            ->all();
    }

    /**
     * @return list<array{id: int, symbol_name: string, filepath: string, cyclomatic: int, cognitive: int|null, line_start: int, line_end: int|null, severity: string|null, trend: string}>
     */
    public function getTopFunctions(Repository $repository): array
    {
        $latestRun = $this->latestBaselineRun($repository);

        if (! $latestRun) {
            return [];
        }

        $latestSnapshots = $latestRun->complexitySnapshots()
            ->orderByDesc('cyclomatic')
            ->limit(10)
            ->get();

        $previousSnapshotsByKey = $this->previousSnapshotsByKey($repository, $latestRun, $latestSnapshots);

        return $latestSnapshots->map(fn ($snapshot) => [
            'id' => $snapshot->id,
            'symbol_name' => $snapshot->symbol_name,
            'filepath' => $snapshot->filepath,
            'cyclomatic' => $snapshot->cyclomatic,
            'cognitive' => $snapshot->cognitive,
            'line_start' => $snapshot->line_start,
            'line_end' => $snapshot->line_end,
            'severity' => $snapshot->severity?->value,
            'trend' => $this->snapshotTrend($snapshot, $previousSnapshotsByKey),
        ])->all();
    }

    private function latestBaselineRun(Repository $repository): ?\App\Models\ReviewRun
    {
        return $repository->reviewRuns()
            ->baseline()
            ->where('status', ReviewRunStatus::Completed)
            ->latest('completed_at')
            ->first();
    }

    /**
     * @return \Illuminate\Support\Collection<string, \App\Models\ComplexitySnapshot>
     */
    private function previousSnapshotsByKey(Repository $repository, \App\Models\ReviewRun $latestRun, \Illuminate\Support\Collection $latestSnapshots): \Illuminate\Support\Collection
    {
        $previousRun = $repository->reviewRuns()
            ->baseline()
            ->where('status', ReviewRunStatus::Completed)
            ->whereNotNull('completed_at')
            ->where('completed_at', '<', $latestRun->completed_at)
            ->latest('completed_at')
            ->first();

        if (! $previousRun) {
            return collect();
        }

        $latestKeys = $latestSnapshots
            ->map(fn ($s) => $s->filepath.'|'.$s->symbol_name)
            ->all();

        return $previousRun->complexitySnapshots()
            ->whereIn('filepath', $latestSnapshots->pluck('filepath')->unique())
            ->get()
            ->filter(fn ($s) => in_array($s->filepath.'|'.$s->symbol_name, $latestKeys))
            ->keyBy(fn ($s) => $s->filepath.'|'.$s->symbol_name);
    }

    private function snapshotTrend(\App\Models\ComplexitySnapshot $snapshot, \Illuminate\Support\Collection $previousSnapshotsByKey): string
    {
        if ($previousSnapshotsByKey->isEmpty()) {
            return 'new';
        }

        $prevSnapshot = $previousSnapshotsByKey->get($snapshot->filepath.'|'.$snapshot->symbol_name);

        if (! $prevSnapshot) {
            return 'new';
        }

        $diff = $snapshot->cyclomatic - $prevSnapshot->cyclomatic;

        return match (true) {
            $diff > 0 => 'up',
            $diff < 0 => 'down',
            default => 'stable',
        };
    }

    /**
     * @return list<array{id: int, symbol_name: string, filepath: string, cyclomatic: int, cognitive: int|null, line_start: int, line_end: int|null, severity: string|null}>
     */
    public function getClusterMapData(Repository $repository): array
    {
        $latestRun = $repository->reviewRuns()
            ->baseline()
            ->where('status', ReviewRunStatus::Completed)
            ->latest('completed_at')
            ->first();

        if (! $latestRun) {
            return [];
        }

        return $latestRun->complexitySnapshots()
            ->orderByDesc('cyclomatic')
            ->limit(50)
            ->get()
            ->map(fn ($snapshot) => [
                'id' => $snapshot->id,
                'symbol_name' => $snapshot->symbol_name,
                'filepath' => $snapshot->filepath,
                'cyclomatic' => $snapshot->cyclomatic,
                'cognitive' => $snapshot->cognitive,
                'line_start' => $snapshot->line_start,
                'line_end' => $snapshot->line_end,
                'severity' => $snapshot->severity?->value,
            ])
            ->all();
    }

    /**
     * @return list<array{id: int, type: string, status: string, pr_number: int|null, head_sha: string|null, files_analyzed: int|null, cost: float|null, started_at: string|null, completed_at: string|null, created_at: string, duration_seconds: int|null}>
     */
    public function getRecentRuns(Repository $repository, int $limit = 10): array
    {
        return $repository->reviewRuns()
            ->latest('created_at')
            ->limit($limit)
            ->get(['id', 'type', 'status', 'pr_number', 'head_sha', 'files_analyzed', 'cost', 'started_at', 'completed_at', 'created_at'])
            ->map(fn ($run) => [
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
            ])
            ->all();
    }

    /**
     * @return array{distinct_prs: int, comments_posted: int}
     */
    public function getReviewActivity(Repository $repository, int $days = 30): array
    {
        $since = now()->subDays($days);

        return [
            'distinct_prs' => (int) $repository->reviewRuns()
                ->pr()
                ->where('review_runs.status', ReviewRunStatus::Completed)
                ->where('review_runs.completed_at', '>=', $since)
                ->distinct('pr_number')
                ->count('pr_number'),
            'comments_posted' => (int) $repository->reviewRuns()
                ->where('review_runs.status', ReviewRunStatus::Completed)
                ->where('review_runs.completed_at', '>=', $since)
                ->join('review_comments', 'review_runs.id', '=', 'review_comments.review_run_id')
                ->where('review_comments.status', ReviewCommentStatus::Posted)
                ->count(),
        ];
    }

    /**
     * @return array{data: list<array<string, mixed>>, total: int, page: int, has_more: bool}
     */
    public function getGroupedPrRuns(Repository $repository, int $page = 1, int $perPage = 20): array
    {
        $baseQuery = $repository->reviewRuns()
            ->where('type', ReviewRunType::Pr)
            ->whereNotNull('pr_number');

        $total = (int) (clone $baseQuery)->distinct('pr_number')->count('pr_number');

        if ($total === 0) {
            return ['data' => [], 'total' => 0, 'page' => $page, 'has_more' => false];
        }

        $prNumbers = (clone $baseQuery)
            ->selectRaw('pr_number, MAX(created_at) as latest_created_at')
            ->groupBy('pr_number')
            ->orderByDesc('latest_created_at')
            ->offset(max(0, ($page - 1) * $perPage))
            ->limit($perPage)
            ->pluck('pr_number');

        if ($prNumbers->isEmpty()) {
            return ['data' => [], 'total' => $total, 'page' => $page, 'has_more' => false];
        }

        $runs = $baseQuery
            ->whereIn('pr_number', $prNumbers)
            ->withCount(['reviewComments as comments_posted_count' => fn ($q) => $q->where('status', ReviewCommentStatus::Posted)])
            ->orderByDesc('created_at')
            ->get();

        $grouped = $runs->groupBy('pr_number');

        $groups = $prNumbers
            ->filter(fn ($prNumber) => $grouped->has($prNumber))
            ->map(fn ($prNumber) => $this->buildPrGroup($grouped->get($prNumber), $prNumber))
            ->values()
            ->all();

        return [
            'data' => $groups,
            'total' => $total,
            'page' => $page,
            'has_more' => ($page * $perPage) < $total,
        ];
    }

    /**
     * @param  \Illuminate\Support\Collection<int, \App\Models\ReviewRun>  $prRuns
     * @return array<string, mixed>
     */
    private function buildPrGroup(\Illuminate\Support\Collection $prRuns, int $prNumber): array
    {
        $latest = $prRuns->first();
        $completedRuns = $prRuns->filter(fn ($r) => $r->status === ReviewRunStatus::Completed);

        return [
            'pr_number' => $prNumber,
            'pr_title' => $latest->pr_title ?? $prRuns->firstWhere('pr_title', '!=', null)?->pr_title,
            'head_ref' => $latest->head_ref ?? $prRuns->firstWhere('head_ref', '!=', null)?->head_ref,
            'base_ref' => $latest->base_ref ?? $prRuns->firstWhere('base_ref', '!=', null)?->base_ref,
            'runs_count' => $prRuns->count(),
            'latest_status' => $latest->status->value,
            'latest_run_id' => $latest->id,
            'first_run_at' => $prRuns->last()->created_at->toISOString(),
            'latest_run_at' => $latest->created_at->toISOString(),
            'evolution' => $completedRuns->map(fn ($r) => $this->formatRunSummary($r))->values()->all(),
            'delta' => $this->computeDelta($completedRuns),
            'runs' => $prRuns->map(fn ($r) => $this->formatRunSummary($r, includeStatus: true))->values()->all(),
        ];
    }

    /**
     * @return array<string, mixed>
     */
    private function formatRunSummary(\App\Models\ReviewRun $run, bool $includeStatus = false): array
    {
        $summary = [
            'id' => $run->id,
            'head_sha' => $run->head_sha ? substr($run->head_sha, 0, 7) : null,
            'avg_complexity' => $run->avg_complexity !== null ? (float) $run->avg_complexity : null,
            'max_complexity' => $run->max_complexity !== null ? (float) $run->max_complexity : null,
            'comments_posted_count' => (int) $run->comments_posted_count,
            'created_at' => $run->created_at->toISOString(),
        ];

        if ($includeStatus) {
            $summary['status'] = $run->status->value;
        }

        return $summary;
    }

    /**
     * @param  \Illuminate\Support\Collection<int, \App\Models\ReviewRun>  $completedRuns
     * @return array{avg_complexity_change: float|null, max_complexity_change: float|null, comments_change: int|null}
     */
    private function computeDelta(\Illuminate\Support\Collection $completedRuns): array
    {
        if ($completedRuns->count() < 2) {
            return ['avg_complexity_change' => null, 'max_complexity_change' => null, 'comments_change' => null];
        }

        $first = $completedRuns->last();
        $latest = $completedRuns->first();

        return [
            'avg_complexity_change' => ($first->avg_complexity !== null && $latest->avg_complexity !== null)
                ? round((float) $latest->avg_complexity - (float) $first->avg_complexity, 2)
                : null,
            'max_complexity_change' => ($first->max_complexity !== null && $latest->max_complexity !== null)
                ? round((float) $latest->max_complexity - (float) $first->max_complexity, 2)
                : null,
            'comments_change' => (int) $latest->comments_posted_count - (int) $first->comments_posted_count,
        ];
    }

    /**
     * @return array{total_tokens: int, total_cost: float, total_runs: int}
     */
    public function getCostTracking(Repository $repository, int $days = 30): array
    {
        $since = now()->subDays($days);

        $stats = $repository->reviewRuns()
            ->where('review_runs.status', ReviewRunStatus::Completed)
            ->where('review_runs.completed_at', '>=', $since)
            ->selectRaw('COALESCE(SUM(token_usage), 0) as total_tokens, COALESCE(SUM(cost), 0) as total_cost, COUNT(*) as total_runs')
            ->first();

        return [
            'total_tokens' => (int) $stats->total_tokens,
            'total_cost' => (float) $stats->total_cost,
            'total_runs' => (int) $stats->total_runs,
        ];
    }
}
