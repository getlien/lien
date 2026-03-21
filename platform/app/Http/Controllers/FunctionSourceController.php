<?php

namespace App\Http\Controllers;

use App\Http\Controllers\Concerns\DetectsLanguage;
use App\Models\ComplexitySnapshot;
use App\Models\Repository;
use App\Services\GitHubAppService;
use Illuminate\Http\JsonResponse;
use Illuminate\Support\Facades\Http;

class FunctionSourceController extends Controller
{
    use DetectsLanguage;

    public function __construct(private GitHubAppService $github) {}

    public function show(Repository $repository, ComplexitySnapshot $complexitySnapshot): JsonResponse
    {
        $this->authorize('view', $repository);

        if ($complexitySnapshot->repository_id !== $repository->id) {
            abort(404);
        }

        $reviewRun = $complexitySnapshot->reviewRun;
        $organization = $repository->organization;

        if (! $organization->github_installation_id) {
            return response()->json(['error' => 'GitHub App not installed for this organization.'], 422);
        }

        if (! $reviewRun->head_sha) {
            return response()->json(['error' => 'No commit SHA available for this review run.'], 422);
        }

        $token = $this->github->getInstallationToken($organization->github_installation_id);

        $encodedFilepath = implode('/', array_map('rawurlencode', explode('/', $complexitySnapshot->filepath)));

        $response = Http::withToken($token)
            ->acceptJson()
            ->timeout(10)
            ->get("https://api.github.com/repos/{$repository->full_name}/contents/{$encodedFilepath}", [
                'ref' => $reviewRun->head_sha,
            ]);

        if (! $response->successful()) {
            return response()->json(['error' => 'Unable to fetch source code from GitHub.'], 502);
        }

        $encoding = $response->json('encoding');
        $rawContent = $response->json('content');

        if ($encoding !== 'base64' || ! is_string($rawContent)) {
            return response()->json(['error' => 'Unexpected content format returned by GitHub.'], 502);
        }

        $content = base64_decode($rawContent, true);

        if ($content === false) {
            return response()->json(['error' => 'Unable to decode file contents returned by GitHub.'], 502);
        }

        $allLines = explode("\n", $content);

        $lineStart = max(1, $complexitySnapshot->line_start);
        $lineEnd = $complexitySnapshot->line_end
            ? min(count($allLines), $complexitySnapshot->line_end)
            : count($allLines);

        $functionLines = array_slice($allLines, $lineStart - 1, $lineEnd - $lineStart + 1);

        return response()->json([
            'source' => implode("\n", $functionLines),
            'line_start' => $lineStart,
            'line_end' => $lineEnd,
            'filepath' => $complexitySnapshot->filepath,
            'language' => $this->detectLanguage($complexitySnapshot->filepath),
        ]);
    }
}
