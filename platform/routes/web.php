<?php

use App\Http\Controllers\Auth\GitHubAuthController;
use App\Http\Controllers\DashboardController;
use App\Http\Controllers\FindingsController;
use App\Http\Controllers\FindingSourceController;
use App\Http\Controllers\FunctionSourceController;
use App\Http\Controllers\OnboardingController;
use App\Http\Controllers\RepositoryConfigController;
use App\Http\Controllers\RepositoryDashboardController;
use App\Http\Controllers\RepositoryFindingsController;
use App\Http\Controllers\ReviewRunController;
use Illuminate\Support\Facades\Route;
use Inertia\Inertia;

Route::get('/', function () {
    return Inertia::render('Welcome');
})->name('home');

Route::middleware('guest')->group(function () {
    Route::get('/auth/github', [GitHubAuthController::class, 'redirect'])->name('github.redirect');
    Route::get('/auth/github/callback', [GitHubAuthController::class, 'callback'])->name('github.callback');
});

Route::middleware('auth')->group(function () {
    Route::post('/auth/logout', [GitHubAuthController::class, 'logout'])->name('logout');

    Route::get('/dashboard', [DashboardController::class, 'show'])->name('dashboard');
    Route::get('/findings', [FindingsController::class, 'index'])->name('findings');

    Route::get('/onboarding/organizations', [OnboardingController::class, 'showOrganizations'])->name('onboarding.organizations');
    Route::post('/onboarding/organizations', [OnboardingController::class, 'selectOrganization'])->name('onboarding.organizations.select');
    Route::get('/onboarding/repositories', [OnboardingController::class, 'showRepositories'])->name('onboarding.repositories');
    Route::post('/onboarding/repositories', [OnboardingController::class, 'selectRepositories'])->name('onboarding.repositories.select');

    Route::get('/repos/{repository}/config', [RepositoryConfigController::class, 'show'])->name('repositories.config');
    Route::put('/repos/{repository}/config', [RepositoryConfigController::class, 'update'])->name('repositories.config.update');
    Route::delete('/repos/{repository}/config', [RepositoryConfigController::class, 'destroy'])->name('repositories.config.destroy');

    Route::get('/repos/{repository}/dashboard', [RepositoryDashboardController::class, 'show'])->name('repositories.dashboard');
    Route::get('/repos/{repository}/findings', [RepositoryFindingsController::class, 'index'])->name('repositories.findings');

    Route::get('/repos/{repository}/functions/{complexitySnapshot}/source', [FunctionSourceController::class, 'show'])->name('repositories.functions.source');
    Route::get('/repos/{repository}/findings/{reviewComment}/source', [FindingSourceController::class, 'show'])->name('repositories.findings.source');

    Route::get('/repos/{repository}/runs', [ReviewRunController::class, 'index'])->name('repositories.runs.index');
    Route::get('/repos/{repository}/runs/{reviewRun}', [ReviewRunController::class, 'show'])->name('repositories.runs.show');
    Route::get('/repos/{repository}/runs/{reviewRun}/logs', [ReviewRunController::class, 'logs'])->name('repositories.runs.logs');
});
