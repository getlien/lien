<?php

namespace Tests\Feature\Onboarding;

use App\Models\Organization;
use App\Models\User;
use App\Services\GitHubService;
use Illuminate\Foundation\Testing\RefreshDatabase;
use Mockery;
use Tests\TestCase;

class OnboardingTest extends TestCase
{
    use RefreshDatabase;

    public function test_show_organizations_page(): void
    {
        $user = User::factory()->githubOnly()->create();

        $this->mock(GitHubService::class, function ($mock) {
            $mock->shouldReceive('getOrganizations')
                ->once()
                ->andReturn([
                    ['id' => 1, 'login' => 'acme', 'avatar_url' => 'https://example.com/avatar.png'],
                ]);
        });

        $response = $this->actingAs($user)->get('/onboarding/organizations');

        $response->assertOk();
        $response->assertInertia(fn ($page) => $page
            ->component('Onboarding/SelectOrganization')
            ->has('organizations', 1)
        );
    }

    public function test_select_organization_creates_record(): void
    {
        $user = User::factory()->githubOnly()->create();

        $this->mock(GitHubService::class, function ($mock) {
            $mock->shouldReceive('getOrganizations')
                ->once()
                ->andReturn([
                    ['id' => 99999, 'login' => 'acme'],
                ]);

            $mock->shouldReceive('getOrganization')
                ->once()
                ->with(Mockery::type(User::class), 'acme')
                ->andReturn([
                    'id' => 99999,
                    'login' => 'acme',
                    'name' => 'Acme Corp',
                    'avatar_url' => 'https://example.com/avatar.png',
                ]);
        });

        $response = $this->actingAs($user)->post('/onboarding/organizations', [
            'login' => 'acme',
        ]);

        $response->assertRedirect('/onboarding/repositories');

        $this->assertDatabaseHas('organizations', [
            'github_id' => 99999,
            'name' => 'Acme Corp',
            'login' => 'acme',
            'slug' => 'acme',
        ]);

        $this->assertTrue($user->organizations()->where('github_id', 99999)->exists());
    }

    public function test_show_repositories_page(): void
    {
        $user = User::factory()->githubOnly()->create();
        $org = Organization::factory()->create();
        $user->organizations()->attach($org->id, ['role' => 'admin']);

        $this->mock(GitHubService::class, function ($mock) use ($org) {
            $mock->shouldReceive('getOrganizationRepos')
                ->once()
                ->andReturn([
                    ['id' => 1, 'name' => 'my-repo', 'full_name' => $org->slug.'/my-repo', 'default_branch' => 'main', 'private' => false],
                ]);
        });

        $response = $this->actingAs($user)
            ->withSession(['onboarding_org_id' => $org->id])
            ->get('/onboarding/repositories');

        $response->assertOk();
        $response->assertInertia(fn ($page) => $page
            ->component('Onboarding/SelectRepositories')
            ->has('repositories', 1)
        );
    }

    public function test_show_repositories_redirects_without_org_in_session(): void
    {
        $user = User::factory()->githubOnly()->create();

        $response = $this->actingAs($user)->get('/onboarding/repositories');

        $response->assertRedirect('/onboarding/organizations');
    }

    public function test_select_repositories_creates_records(): void
    {
        $user = User::factory()->githubOnly()->create();
        $org = Organization::factory()->create();
        $user->organizations()->attach($org->id, ['role' => 'admin']);

        $this->mock(GitHubService::class, function ($mock) use ($org) {
            $mock->shouldReceive('getOrganizationRepos')
                ->once()
                ->with(Mockery::type(User::class), $org->login)
                ->andReturn([
                    ['id' => 11111, 'full_name' => 'acme/repo-one', 'default_branch' => 'main', 'private' => false],
                    ['id' => 22222, 'full_name' => 'acme/repo-two', 'default_branch' => 'develop', 'private' => true],
                ]);
        });

        $response = $this->actingAs($user)
            ->withSession(['onboarding_org_id' => $org->id])
            ->post('/onboarding/repositories', [
                'repositories' => [
                    ['id' => 11111, 'full_name' => 'acme/repo-one', 'default_branch' => 'main', 'private' => false],
                    ['id' => 22222, 'full_name' => 'acme/repo-two', 'default_branch' => 'develop', 'private' => true],
                ],
            ]);

        $response->assertRedirect('/dashboard');

        $this->assertDatabaseHas('repositories', [
            'github_id' => 11111,
            'full_name' => 'acme/repo-one',
            'organization_id' => $org->id,
        ]);

        $this->assertDatabaseHas('repositories', [
            'github_id' => 22222,
            'full_name' => 'acme/repo-two',
            'is_private' => true,
        ]);
    }

    public function test_select_repositories_requires_at_least_one(): void
    {
        $user = User::factory()->githubOnly()->create();
        $org = Organization::factory()->create();

        $response = $this->actingAs($user)
            ->withSession(['onboarding_org_id' => $org->id])
            ->post('/onboarding/repositories', [
                'repositories' => [],
            ]);

        $response->assertSessionHasErrors('repositories');
    }

    public function test_guest_cannot_access_onboarding(): void
    {
        $response = $this->get('/onboarding/organizations');

        $response->assertRedirect('/');
    }
}
