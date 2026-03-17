<?php

namespace App\Services;

use App\Enums\ReviewRunStatus;
use App\Enums\ReviewRunType;
use App\Models\ReviewRun;
use Illuminate\Pagination\LengthAwarePaginator;
use Illuminate\Support\Collection;

class DashboardService
{
    /**
     * @param  Collection<int, int>  $repoIds
     */
    public function getAllRuns(
        Collection $repoIds,
        ?string $type = null,
        ?string $status = null,
        ?int $repoFilter = null,
        int $perPage = 20,
    ): LengthAwarePaginator {
        $query = ReviewRun::with('repository:id,full_name')
            ->whereIn('repository_id', $repoIds)
            ->latest('created_at');

        if ($type && ReviewRunType::tryFrom($type)) {
            $query->where('type', $type);
        }

        if ($status && ReviewRunStatus::tryFrom($status)) {
            $query->where('status', $status);
        }

        if ($repoFilter) {
            $query->where('repository_id', $repoFilter);
        }

        return $query->paginate($perPage)
            ->withQueryString()
            ->through(fn (ReviewRun $run) => $this->formatRun($run));
    }

    /**
     * @param  Collection<int, int>  $repoIds
     */
    public function getGroupedByPr(
        Collection $repoIds,
        ?string $status = null,
        ?int $repoFilter = null,
        int $perPage = 20,
        int $page = 1,
    ): LengthAwarePaginator {
        $runs = $this->fetchRecentRuns($repoIds, $repoFilter);

        $groups = $runs->groupBy(fn (ReviewRun $run) => $run->type === ReviewRunType::Baseline
            ? $run->repository_id.':baseline'
            : $run->repository_id.':pr:'.$run->pr_number
        );

        $mapped = $groups->map(fn (Collection $groupRuns) => $this->buildGroupData($groupRuns));

        if ($status && ReviewRunStatus::tryFrom($status)) {
            $mapped = $mapped->filter(fn (array $group) => $group['latest_status'] === $status);
        }

        return $this->manualPaginate($mapped->sortByDesc('last_run_at')->values(), $perPage, $page);
    }

    /**
     * @return array<string, mixed>
     */
    private function formatRun(ReviewRun $run): array
    {
        return [
            'id' => $run->id,
            'repository_id' => $run->repository_id,
            'repository_name' => $run->repository->full_name,
            'type' => $run->type->value,
            'status' => $run->status->value,
            'pr_number' => $run->pr_number,
            'pr_title' => $run->pr_title,
            'head_sha' => $run->head_sha ? substr($run->head_sha, 0, 7) : null,
            'head_ref' => $run->head_ref,
            'avg_complexity' => $run->avg_complexity !== null ? (float) $run->avg_complexity : null,
            'max_complexity' => $run->max_complexity !== null ? (float) $run->max_complexity : null,
            'files_analyzed' => $run->files_analyzed,
            'created_at' => $run->created_at->toISOString(),
            'completed_at' => $run->completed_at?->toISOString(),
            'duration_seconds' => $run->started_at && $run->completed_at
                ? $run->started_at->diffInSeconds($run->completed_at)
                : null,
        ];
    }

    /**
     * @param  Collection<int, int>  $repoIds
     * @return Collection<int, ReviewRun>
     */
    private function fetchRecentRuns(Collection $repoIds, ?int $repoFilter): Collection
    {
        $query = ReviewRun::with('repository:id,full_name')
            ->whereIn('repository_id', $repoIds)
            ->where('created_at', '>=', now()->subDays(90));

        if ($repoFilter) {
            $query->where('repository_id', $repoFilter);
        }

        return $query->latest('created_at')->limit(500)->get();
    }

    /**
     * @param  Collection<int, ReviewRun>  $groupRuns
     * @return array<string, mixed>
     */
    private function buildGroupData(Collection $groupRuns): array
    {
        $latest = $groupRuns->first();
        $completedRuns = $groupRuns->filter(fn (ReviewRun $r) => $r->status === ReviewRunStatus::Completed);
        $isBaseline = $latest->type === ReviewRunType::Baseline;
        $latestCompleted = $completedRuns->first();

        return [
            'repository_id' => $latest->repository_id,
            'repository_name' => $latest->repository->full_name,
            'type' => $isBaseline ? 'baseline' : 'pr',
            'pr_number' => $isBaseline ? null : $latest->pr_number,
            'pr_title' => $isBaseline ? null : $latest->pr_title,
            'head_ref' => $isBaseline ? null : $latest->head_ref,
            'runs_count' => $groupRuns->count(),
            'latest_status' => $latest->status->value,
            'latest_avg_complexity' => $latestCompleted?->avg_complexity !== null
                ? (float) $latestCompleted->avg_complexity
                : null,
            'complexity_delta' => $this->computeComplexityDelta($completedRuns),
            'last_run_at' => $latest->created_at->toISOString(),
            'trend_data' => $this->extractTrendData($completedRuns),
            'latest_run_id' => $latest->id,
        ];
    }

    /**
     * @param  Collection<int, ReviewRun>  $completedRuns
     */
    private function computeComplexityDelta(Collection $completedRuns): ?float
    {
        $latest = $completedRuns->first();
        $previous = $completedRuns->skip(1)->first();

        if (! $latest || ! $previous || $latest->avg_complexity === null || $previous->avg_complexity === null) {
            return null;
        }

        return round((float) $latest->avg_complexity - (float) $previous->avg_complexity, 1);
    }

    /**
     * @param  Collection<int, ReviewRun>  $completedRuns
     * @return list<float>
     */
    private function extractTrendData(Collection $completedRuns): array
    {
        return $completedRuns
            ->take(10)
            ->reverse()
            ->map(fn (ReviewRun $r) => $r->avg_complexity !== null ? (float) $r->avg_complexity : null)
            ->filter(fn ($v) => $v !== null)
            ->values()
            ->all();
    }

    private function manualPaginate(Collection $items, int $perPage, int $page): LengthAwarePaginator
    {
        return new LengthAwarePaginator(
            $items->slice(($page - 1) * $perPage, $perPage)->values(),
            $items->count(),
            $perPage,
            $page,
            ['path' => request()->url(), 'query' => request()->query()],
        );
    }
}
