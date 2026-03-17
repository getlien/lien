<?php

namespace App\Http\Controllers\Api\V1;

use App\Enums\ReviewRunStatus;
use App\Http\Controllers\Controller;
use App\Http\Requests\Api\V1\StoreReviewRunLogsRequest;
use App\Http\Requests\Api\V1\StoreReviewRunRequest;
use App\Http\Requests\Api\V1\UpdateReviewRunStatusRequest;
use App\Models\ReviewRun;
use App\Services\ReviewRunService;
use Illuminate\Http\JsonResponse;

class ReviewRunController extends Controller
{
    public function __construct(private ReviewRunService $reviewRunService) {}

    public function store(StoreReviewRunRequest $request): JsonResponse
    {
        $validated = $request->validated();

        $reviewRun = $this->reviewRunService->createOrUpdate($validated);

        return response()->json([
            'review_run_id' => $reviewRun->id,
        ], $reviewRun->wasRecentlyCreated ? 201 : 200);
    }

    public function updateStatus(UpdateReviewRunStatusRequest $request, ReviewRun $reviewRun): JsonResponse
    {
        $validated = $request->validated();

        $this->reviewRunService->updateStatus(
            $reviewRun,
            ReviewRunStatus::from($validated['status']),
        );

        return response()->json([
            'review_run_id' => $reviewRun->id,
            'status' => $reviewRun->fresh()->status->value,
        ]);
    }

    public function storeLogs(StoreReviewRunLogsRequest $request, ReviewRun $reviewRun): JsonResponse
    {
        $validated = $request->validated();

        $now = now();
        $rows = array_map(function (array $log) use ($reviewRun, $now) {
            if (isset($log['metadata'])) {
                $log['metadata'] = json_encode($log['metadata']);
            }

            return [
                ...$log,
                'review_run_id' => $reviewRun->id,
                'created_at' => $now,
            ];
        }, $validated['logs']);

        $reviewRun->logs()->insert($rows);

        return response()->json([
            'stored' => count($validated['logs']),
        ]);
    }
}
