<?php

namespace App\Services;

use App\Models\Repository;
use Illuminate\Support\Facades\Http;

class GitHubFileService
{
    public function __construct(private GitHubAppService $github) {}

    /**
     * Fetch file content from GitHub and extract a line range.
     *
     * @return array{source: string, line_start: int, line_end: int, filepath: string, language: string}
     *
     * @throws \Illuminate\Http\Client\RequestException
     */
    public function fetchLines(
        Repository $repository,
        string $filepath,
        string $sha,
        int $lineStart,
        ?int $lineEnd = null,
    ): array {
        $allLines = $this->fetchFileLines($repository, $filepath, $sha);
        $totalLines = count($allLines);

        $start = max(1, $lineStart);
        $end = $lineEnd ? min($totalLines, $lineEnd) : $totalLines;

        $sourceLines = array_slice($allLines, $start - 1, $end - $start + 1);

        return [
            'source' => implode("\n", $sourceLines),
            'line_start' => $start,
            'line_end' => $end,
            'filepath' => $filepath,
            'language' => $this->detectLanguage($filepath),
        ];
    }

    /**
     * Fetch the added line numbers for a file in a PR.
     *
     * @return list<int>
     */
    public function fetchAddedLines(Repository $repository, int $prNumber, string $filepath): array
    {
        $organization = $repository->organization;

        if (! $organization->github_installation_id) {
            return [];
        }

        try {
            $token = $this->github->getInstallationToken($organization->github_installation_id);

            $response = Http::withToken($token)
                ->acceptJson()
                ->timeout(10)
                ->get("https://api.github.com/repos/{$repository->full_name}/pulls/{$prNumber}/files");

            if (! $response->successful()) {
                return [];
            }

            $files = $response->json();

            foreach ($files as $file) {
                if (($file['filename'] ?? '') === $filepath && isset($file['patch'])) {
                    return $this->parseAddedLines($file['patch']);
                }
            }
        } catch (\Throwable) {
            // Gracefully degrade — diff is optional
        }

        return [];
    }

    /**
     * Parse a unified diff patch to extract added line numbers.
     *
     * @return list<int>
     */
    private function parseAddedLines(string $patch): array
    {
        $lines = [];
        $currentLine = 0;

        foreach (explode("\n", $patch) as $line) {
            if (preg_match('/^@@ -\d+(?:,\d+)? \+(\d+)/', $line, $m)) {
                $currentLine = (int) $m[1];

                continue;
            }

            if (str_starts_with($line, '+')) {
                $lines[] = $currentLine;
                $currentLine++;
            } elseif (str_starts_with($line, '-')) {
                // Deleted line — don't increment file line counter
            } else {
                $currentLine++;
            }
        }

        return $lines;
    }

    /**
     * @return list<string>
     */
    private function fetchFileLines(Repository $repository, string $filepath, string $sha): array
    {
        $organization = $repository->organization;

        if (! $organization->github_installation_id) {
            abort(response()->json(['error' => 'GitHub App not installed for this organization.'], 422));
        }

        $token = $this->github->getInstallationToken($organization->github_installation_id);
        $encodedFilepath = implode('/', array_map('rawurlencode', explode('/', $filepath)));

        $response = Http::withToken($token)
            ->acceptJson()
            ->timeout(10)
            ->get("https://api.github.com/repos/{$repository->full_name}/contents/{$encodedFilepath}", [
                'ref' => $sha,
            ]);

        if (! $response->successful()) {
            abort(response()->json(['error' => 'Unable to fetch source code from GitHub.'], 502));
        }

        $encoding = $response->json('encoding');
        $rawContent = $response->json('content');

        if ($encoding !== 'base64' || ! is_string($rawContent)) {
            abort(response()->json(['error' => 'Unexpected content format returned by GitHub.'], 502));
        }

        $content = base64_decode($rawContent, true);

        if ($content === false) {
            abort(response()->json(['error' => 'Unable to decode file contents returned by GitHub.'], 502));
        }

        return explode("\n", $content);
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
