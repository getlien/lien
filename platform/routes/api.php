<?php

use App\Http\Controllers\Api\V1\RepoConfigController;
use App\Http\Controllers\Api\V1\ReviewRunController;
use App\Http\Controllers\Api\Webhooks\GitHubWebhookController;
use Illuminate\Support\Facades\Route;

Route::middleware(['auth.service-token', 'throttle:api'])->prefix('v1')->group(function () {
    Route::get('/repos/{repository}/config', [RepoConfigController::class, 'show']);
    Route::put('/repos/{repository}/config', [RepoConfigController::class, 'update']);

    Route::post('/review-runs', [ReviewRunController::class, 'store']);
    Route::post('/review-runs/{reviewRun}/status', [ReviewRunController::class, 'updateStatus']);
    Route::post('/review-runs/{reviewRun}/logs', [ReviewRunController::class, 'storeLogs']);
});

Route::middleware(['verify.github-webhook'])->prefix('webhooks')->group(function () {
    Route::post('/github', GitHubWebhookController::class);
});
