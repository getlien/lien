<?php

namespace Tests\Feature;

use App\Models\ComplexitySnapshot;
use App\Models\Organization;
use App\Models\Repository;
use App\Models\ReviewRun;
use App\Models\User;
use App\Services\GitHubAppService;
use Illuminate\Foundation\Testing\RefreshDatabase;
use Illuminate\Support\Facades\Http;
use Tests\TestCase;

class FunctionSourceTest extends TestCase
{
    use RefreshDatabase;

    private function createSetup(array $overrides = []): array
    {
        $user = User::factory()->create();
        $org = Organization::factory()->create([
            'github_installation_id' => array_key_exists('installation_id', $overrides) ? $overrides['installation_id'] : 12345,
        ]);
        $user->organizations()->attach($org->id, ['role' => 'admin']);
        $repo = Repository::factory()->create([
            'organization_id' => $org->id,
            'full_name' => 'acme/app',
        ]);

        $run = ReviewRun::factory()->baseline()->create([
            'repository_id' => $repo->id,
            'head_sha' => array_key_exists('head_sha', $overrides) ? $overrides['head_sha'] : str_repeat('a', 40),
        ]);

        $snapshot = ComplexitySnapshot::factory()->create([
            'review_run_id' => $run->id,
            'repository_id' => $repo->id,
            'filepath' => 'src/handlers/baseline.ts',
            'symbol_name' => 'handleBaseline',
            'line_start' => 10,
            'line_end' => 25,
        ]);

        return compact('user', 'org', 'repo', 'run', 'snapshot');
    }

    private function mockGitHubApp(int $installationId = 12345): void
    {
        $this->mock(GitHubAppService::class, function ($mock) use ($installationId) {
            $mock->shouldReceive('getInstallationToken')
                ->with($installationId)
                ->andReturn('fake-token');
        });
    }

    private function fakeGitHubContents(int $totalLines = 30): void
    {
        $fileContent = implode("\n", array_map(
            fn ($i) => "// line {$i}: some code here",
            range(1, $totalLines)
        ));

        Http::fake([
            'api.github.com/repos/acme/app/contents/*' => Http::response([
                'content' => base64_encode($fileContent),
                'encoding' => 'base64',
            ]),
        ]);
    }

    public function test_authenticated_user_can_fetch_function_source(): void
    {
        $setup = $this->createSetup();
        $this->mockGitHubApp();
        $this->fakeGitHubContents();

        $response = $this->actingAs($setup['user'])
            ->getJson("/repos/{$setup['repo']->id}/functions/{$setup['snapshot']->id}/source");

        $response->assertOk();
        $response->assertJsonStructure(['source', 'line_start', 'line_end', 'filepath', 'language']);
        $response->assertJson([
            'line_start' => 10,
            'line_end' => 25,
            'filepath' => 'src/handlers/baseline.ts',
            'language' => 'typescript',
        ]);
        $this->assertStringContainsString('line 10', $response->json('source'));
        $this->assertStringContainsString('line 25', $response->json('source'));
        $this->assertStringNotContainsString('line 9', $response->json('source'));
        $this->assertStringNotContainsString('line 26', $response->json('source'));
    }

    public function test_guest_gets_unauthorized(): void
    {
        $setup = $this->createSetup();

        $response = $this->getJson("/repos/{$setup['repo']->id}/functions/{$setup['snapshot']->id}/source");

        $response->assertUnauthorized();
    }

    public function test_non_member_gets_forbidden(): void
    {
        $setup = $this->createSetup();
        $outsider = User::factory()->create();

        $response = $this->actingAs($outsider)
            ->getJson("/repos/{$setup['repo']->id}/functions/{$setup['snapshot']->id}/source");

        $response->assertForbidden();
    }

    public function test_snapshot_from_different_repository_returns_not_found(): void
    {
        $setup = $this->createSetup();
        $otherRepo = Repository::factory()->create(['organization_id' => $setup['org']->id]);

        $response = $this->actingAs($setup['user'])
            ->getJson("/repos/{$otherRepo->id}/functions/{$setup['snapshot']->id}/source");

        $response->assertNotFound();
    }

    public function test_missing_installation_id_returns_unprocessable(): void
    {
        $setup = $this->createSetup(['installation_id' => null]);

        $response = $this->actingAs($setup['user'])
            ->getJson("/repos/{$setup['repo']->id}/functions/{$setup['snapshot']->id}/source");

        $response->assertUnprocessable();
        $response->assertJson(['error' => 'GitHub App not installed for this organization.']);
    }

    public function test_missing_head_sha_returns_unprocessable(): void
    {
        $setup = $this->createSetup(['head_sha' => null]);
        $this->mockGitHubApp();

        $response = $this->actingAs($setup['user'])
            ->getJson("/repos/{$setup['repo']->id}/functions/{$setup['snapshot']->id}/source");

        $response->assertUnprocessable();
        $response->assertJson(['error' => 'No commit SHA available for this review run.']);
    }

    public function test_github_api_failure_returns_bad_gateway(): void
    {
        $setup = $this->createSetup();
        $this->mockGitHubApp();

        Http::fake([
            'api.github.com/repos/acme/app/contents/*' => Http::response(
                ['message' => 'Not Found'],
                404
            ),
        ]);

        $response = $this->actingAs($setup['user'])
            ->getJson("/repos/{$setup['repo']->id}/functions/{$setup['snapshot']->id}/source");

        $response->assertStatus(502);
        $response->assertJson(['error' => 'Unable to fetch source code from GitHub.']);
    }

    public function test_language_detection_for_php_files(): void
    {
        $setup = $this->createSetup();
        $this->mockGitHubApp();
        $this->fakeGitHubContents();

        $setup['snapshot']->update(['filepath' => 'app/Services/AuthService.php']);

        $response = $this->actingAs($setup['user'])
            ->getJson("/repos/{$setup['repo']->id}/functions/{$setup['snapshot']->id}/source");

        $response->assertOk();
        $response->assertJson(['language' => 'php']);
    }

    public function test_language_detection_for_javascript_files(): void
    {
        $setup = $this->createSetup();
        $this->mockGitHubApp();
        $this->fakeGitHubContents();

        $setup['snapshot']->update(['filepath' => 'src/utils/helpers.js']);

        $response = $this->actingAs($setup['user'])
            ->getJson("/repos/{$setup['repo']->id}/functions/{$setup['snapshot']->id}/source");

        $response->assertOk();
        $response->assertJson(['language' => 'javascript']);
    }
}
