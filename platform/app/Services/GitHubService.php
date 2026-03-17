<?php

namespace App\Services;

use App\Models\User;
use Illuminate\Support\Facades\Http;

class GitHubService
{
    /**
     * @return list<array<string, mixed>>
     */
    public function getOrganizations(User $user): array
    {
        $response = Http::withToken($user->github_token)
            ->timeout(10)
            ->get('https://api.github.com/user/orgs');

        if (! $response->successful()) {
            return [];
        }

        return $response->json();
    }

    /**
     * @return array<string, mixed>
     */
    public function getOrganization(User $user, string $org): array
    {
        $response = Http::withToken($user->github_token)
            ->timeout(10)
            ->get("https://api.github.com/orgs/{$org}");

        $response->throw();

        return $response->json();
    }

    /**
     * @return list<array<string, mixed>>
     */
    public function getOrganizationRepos(User $user, string $org): array
    {
        $repos = [];
        $page = 1;
        $maxPages = 10;

        do {
            $response = Http::withToken($user->github_token)
                ->timeout(10)
                ->get("https://api.github.com/orgs/{$org}/repos", [
                    'per_page' => 100,
                    'page' => $page,
                    'sort' => 'updated',
                ]);

            if (! $response->successful()) {
                break;
            }

            $pageData = $response->json();

            if (empty($pageData)) {
                break;
            }

            $repos = array_merge($repos, $pageData);
            $page++;
        } while (count($pageData) === 100 && $page <= $maxPages);

        return $repos;
    }
}
