<?php

namespace App\Services;

use App\Enums\ReviewRunStatus;
use App\Models\ReviewRun;
use Illuminate\Support\Facades\Http;
use Illuminate\Support\Facades\Log;

class GitHubCheckService
{
    /**
     * Create a GitHub Check Run for a review run.
     *
     * Returns the GitHub check run ID, or null on failure.
     */
    public function createCheckRun(ReviewRun $reviewRun, string $installationToken): ?int
    {
        $repository = $reviewRun->repository;

        if (! $reviewRun->head_sha) {
            return null;
        }

        $detailsUrl = route('repositories.runs.show', [
            'repository' => $repository->id,
            'reviewRun' => $reviewRun->id,
        ]);

        $response = Http::withToken($installationToken)
            ->acceptJson()
            ->post("https://api.github.com/repos/{$repository->full_name}/check-runs", [
                'name' => 'Lien Review',
                'head_sha' => $reviewRun->head_sha,
                'status' => 'queued',
                'details_url' => $detailsUrl,
                'external_id' => (string) $reviewRun->id,
            ]);

        if (! $response->successful()) {
            Log::warning('Failed to create GitHub check run', [
                'review_run_id' => $reviewRun->id,
                'response' => $response->body(),
            ]);

            return null;
        }

        return $response->json('id');
    }

    /**
     * Update a GitHub Check Run to reflect the current review run status.
     */
    public function updateCheckRun(ReviewRun $reviewRun, int $checkRunId, string $installationToken): void
    {
        $repository = $reviewRun->repository;

        $payload = [
            'status' => $this->mapStatus($reviewRun->status),
        ];

        if (in_array($reviewRun->status, [ReviewRunStatus::Completed, ReviewRunStatus::Failed])) {
            $payload['conclusion'] = $reviewRun->status === ReviewRunStatus::Completed
                ? 'success'
                : 'failure';
            $payload['completed_at'] = now()->toIso8601String();
        }

        $response = Http::withToken($installationToken)
            ->acceptJson()
            ->patch("https://api.github.com/repos/{$repository->full_name}/check-runs/{$checkRunId}", $payload);

        if (! $response->successful()) {
            Log::warning('Failed to update GitHub check run', [
                'review_run_id' => $reviewRun->id,
                'check_run_id' => $checkRunId,
                'response' => $response->body(),
            ]);
        }
    }

    /**
     * Complete a GitHub Check Run with a custom conclusion and output.
     */
    public function completeCheckRun(
        ReviewRun $reviewRun,
        int $checkRunId,
        string $installationToken,
        string $conclusion,
        string $title,
        string $summary,
    ): void {
        $repository = $reviewRun->repository;

        $response = Http::withToken($installationToken)
            ->acceptJson()
            ->patch("https://api.github.com/repos/{$repository->full_name}/check-runs/{$checkRunId}", [
                'status' => 'completed',
                'conclusion' => $conclusion,
                'completed_at' => now()->toIso8601String(),
                'output' => [
                    'title' => $title,
                    'summary' => $summary,
                ],
            ]);

        if (! $response->successful()) {
            Log::warning('Failed to complete GitHub check run', [
                'review_run_id' => $reviewRun->id,
                'check_run_id' => $checkRunId,
                'response' => $response->body(),
            ]);
        }
    }

    private function mapStatus(ReviewRunStatus $status): string
    {
        return match ($status) {
            ReviewRunStatus::Pending => 'queued',
            ReviewRunStatus::Running => 'in_progress',
            ReviewRunStatus::Completed, ReviewRunStatus::Failed, ReviewRunStatus::Skipped => 'completed',
        };
    }
}
