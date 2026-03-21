<?php

namespace App\Http\Controllers;

use App\Models\Repository;
use App\Models\ReviewComment;
use App\Services\GitHubAppService;
use Illuminate\Http\JsonResponse;
use Illuminate\Support\Facades\Http;

class FindingSourceController extends Controller
{
    private const CONTEXT_LINES = 10;

    public function __construct(private GitHubAppService $github) {}

    public function show(Repository $repository, ReviewComment $reviewComment): JsonResponse
    {
        $this->authorize('view', $repository);

        $reviewRun = $reviewComment->reviewRun;

        if (! $reviewRun || $reviewRun->repository_id !== $repository->id) {
            abort(404);
        }

        if (! $reviewComment->filepath || ! $reviewComment->line) {
            return response()->json(['error' => 'Finding has no file location.'], 422);
        }

        $organization = $repository->organization;

        if (! $organization->github_installation_id) {
            return response()->json(['error' => 'GitHub App not installed for this organization.'], 422);
        }

        if (! $reviewRun->head_sha) {
            return response()->json(['error' => 'No commit SHA available for this review run.'], 422);
        }

        $token = $this->github->getInstallationToken($organization->github_installation_id);

        $encodedFilepath = implode('/', array_map('rawurlencode', explode('/', $reviewComment->filepath)));

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
        $totalLines = count($allLines);

        $lineStart = max(1, $reviewComment->line - self::CONTEXT_LINES);
        $lineEnd = min($totalLines, $reviewComment->line + self::CONTEXT_LINES);

        $sourceLines = array_slice($allLines, $lineStart - 1, $lineEnd - $lineStart + 1);

        return response()->json([
            'source' => implode("\n", $sourceLines),
            'line_start' => $lineStart,
            'line_end' => $lineEnd,
            'highlight_line' => $reviewComment->line,
            'filepath' => $reviewComment->filepath,
            'language' => $this->detectLanguage((string) $reviewComment->filepath),
        ]);
    }

    private function detectLanguage(string $filepath): string
    {
        $extension = pathinfo($filepath, PATHINFO_EXTENSION);

        return match ($extension) {
            'ts', 'tsx' => 'typescript',
            'js', 'jsx', 'mjs' => 'javascript',
            'php' => 'php',
            'py' => 'python',
            'rb' => 'ruby',
            'go' => 'go',
            'rs' => 'rust',
            'java' => 'java',
            'kt' => 'kotlin',
            'swift' => 'swift',
            'cs' => 'csharp',
            'vue' => 'vue',
            default => 'plaintext',
        };
    }
}
