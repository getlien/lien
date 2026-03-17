<?php

namespace App\Services;

use App\Enums\ReviewRunStatus;
use App\Enums\ReviewRunType;
use App\Models\ReviewRun;
use Illuminate\Support\Facades\DB;

class ReviewRunService
{
    /**
     * @param  array<string, mixed>  $data
     */
    public function createOrUpdate(array $data): ReviewRun
    {
        return DB::transaction(function () use ($data) {
            $reviewRun = $this->upsertReviewRun($data);
            $this->syncRelatedEntities($reviewRun, $data);

            return $reviewRun;
        });
    }

    /**
     * Upsert a review run, preserving webhook-populated PR metadata (pr_title, head_ref, base_ref)
     * unless explicitly provided in $data.
     *
     * @param  array<string, mixed>  $data
     */
    private function upsertReviewRun(array $data): ReviewRun
    {
        $prNumber = $data['pr_number'] ?? null;

        $attributes = [
            'type' => $prNumber === null ? ReviewRunType::Baseline : ReviewRunType::Pr,
            'idempotency_key' => $data['idempotency_key'],
            'committed_at' => $data['committed_at'] ?? null,
            'base_sha' => $data['base_sha'],
            'started_at' => $data['started_at'] ?? null,
            'completed_at' => $data['completed_at'] ?? null,
            'status' => $data['status'] ?? ReviewRunStatus::Pending,
            'files_analyzed' => $data['files_analyzed'] ?? 0,
            'avg_complexity' => $data['avg_complexity'] ?? null,
            'max_complexity' => $data['max_complexity'] ?? null,
            'token_usage' => $data['token_usage'] ?? 0,
            'cost' => $data['cost'] ?? 0,
            'summary_comment_id' => $data['summary_comment_id'] ?? null,
        ];

        foreach (['pr_title', 'head_ref', 'base_ref'] as $field) {
            if (array_key_exists($field, $data)) {
                $attributes[$field] = $data[$field];
            }
        }

        return ReviewRun::updateOrCreate(
            [
                'repository_id' => $data['repository_id'],
                'head_sha' => $data['head_sha'],
                'pr_number' => $prNumber,
            ],
            $attributes,
        );
    }

    /**
     * @param  array<string, mixed>  $data
     */
    private function syncRelatedEntities(ReviewRun $reviewRun, array $data): void
    {
        $this->syncCollection($reviewRun, 'complexitySnapshots', $data, 'complexity_snapshots', 'repository_id');
        $this->syncCollection($reviewRun, 'reviewComments', $data, 'review_comments');
    }

    /**
     * @param  array<string, mixed>  $data
     */
    private function syncCollection(ReviewRun $reviewRun, string $relation, array $data, string $dataKey, ?string $extraField = null): void
    {
        if (! array_key_exists($dataKey, $data)) {
            return;
        }

        if (! $reviewRun->wasRecentlyCreated) {
            $reviewRun->{$relation}()->delete();
        }

        if (empty($data[$dataKey])) {
            return;
        }

        $items = $extraField
            ? array_map(fn ($item) => [...$item, $extraField => $data[$extraField]], $data[$dataKey])
            : $data[$dataKey];

        $reviewRun->{$relation}()->createMany($items);
    }

    public function updateStatus(ReviewRun $reviewRun, ReviewRunStatus $status): ReviewRun
    {
        $updates = ['status' => $status];

        if (in_array($status, [ReviewRunStatus::Completed, ReviewRunStatus::Failed])) {
            $updates['completed_at'] = now();
        }

        if ($status === ReviewRunStatus::Running && ! $reviewRun->started_at) {
            $updates['started_at'] = now();
        }

        $reviewRun->update($updates);

        return $reviewRun;
    }
}
