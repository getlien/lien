<?php

namespace App\Http\Controllers\Api\Webhooks;

use App\Http\Controllers\Controller;
use App\Jobs\ProcessInstallationRepositoriesWebhook;
use App\Jobs\ProcessPullRequestWebhook;
use Illuminate\Http\JsonResponse;
use Illuminate\Http\Request;
use Illuminate\Support\Facades\Log;

class GitHubWebhookController extends Controller
{
    public function __invoke(Request $request): JsonResponse
    {
        $event = $request->header('X-GitHub-Event');
        $payload = $request->all();

        return match ($event) {
            'pull_request' => $this->handlePullRequest($payload),
            'installation_repositories' => $this->handleInstallationRepositories($payload),
            'installation' => $this->handleInstallation($payload),
            default => response()->json(['status' => 'ignored', 'event' => $event]),
        };
    }

    /**
     * @param  array<string, mixed>  $payload
     */
    private function handlePullRequest(array $payload): JsonResponse
    {
        $action = $payload['action'] ?? null;

        if (! in_array($action, ['opened', 'synchronize'])) {
            return response()->json(['status' => 'ignored', 'action' => $action]);
        }

        ProcessPullRequestWebhook::dispatch($payload);

        return response()->json(['status' => 'queued', 'event' => 'pull_request', 'action' => $action]);
    }

    /**
     * @param  array<string, mixed>  $payload
     */
    private function handleInstallationRepositories(array $payload): JsonResponse
    {
        ProcessInstallationRepositoriesWebhook::dispatch($payload);

        return response()->json(['status' => 'queued', 'event' => 'installation_repositories']);
    }

    /**
     * @param  array<string, mixed>  $payload
     */
    private function handleInstallation(array $payload): JsonResponse
    {
        $action = $payload['action'] ?? null;

        if ($action === 'created') {
            // Reuse the installation_repositories handler — same payload shape (has repositories array).
            ProcessInstallationRepositoriesWebhook::dispatch(array_merge($payload, ['action' => 'added', 'repositories_added' => $payload['repositories'] ?? []]));

            return response()->json(['status' => 'queued', 'event' => 'installation', 'action' => $action]);
        }

        if ($action === 'deleted') {
            Log::info('GitHub App installation deleted', [
                'installation_id' => $payload['installation']['id'] ?? null,
                'account' => $payload['installation']['account']['login'] ?? null,
            ]);
        }

        return response()->json(['status' => 'ignored', 'event' => 'installation', 'action' => $action]);
    }
}
