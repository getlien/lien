<?php

namespace Tests\Feature\Auth;

use App\Models\Organization;
use App\Models\User;
use Illuminate\Foundation\Testing\RefreshDatabase;
use Laravel\Socialite\Contracts\Provider;
use Laravel\Socialite\Facades\Socialite;
use Laravel\Socialite\Two\User as SocialiteUser;
use Mockery;
use Tests\TestCase;

class GitHubAuthTest extends TestCase
{
    use RefreshDatabase;

    public function test_github_redirect(): void
    {
        $response = $this->get('/auth/github');

        $response->assertRedirect();
        $this->assertStringContainsString('github.com', $response->headers->get('Location'));
    }

    public function test_github_callback_creates_new_user(): void
    {
        $this->mockSocialiteUser([
            'id' => 12345,
            'nickname' => 'testuser',
            'name' => 'Test User',
            'email' => 'test@example.com',
            'avatar' => 'https://avatars.githubusercontent.com/u/12345',
            'token' => 'gho_test_token_123',
        ]);

        $response = $this->get('/auth/github/callback');

        $response->assertRedirect('/onboarding/organizations');
        $this->assertAuthenticated();
        $this->assertDatabaseHas('users', [
            'github_id' => 12345,
            'github_username' => 'testuser',
            'email' => 'test@example.com',
        ]);
    }

    public function test_github_callback_updates_existing_user(): void
    {
        $user = User::factory()->create([
            'github_id' => 12345,
            'github_username' => 'oldusername',
        ]);

        $this->mockSocialiteUser([
            'id' => 12345,
            'nickname' => 'newusername',
            'name' => 'Updated Name',
            'email' => $user->email,
            'avatar' => 'https://avatars.githubusercontent.com/u/12345',
            'token' => 'gho_new_token',
        ]);

        $response = $this->get('/auth/github/callback');

        $response->assertRedirect('/onboarding/organizations');
        $this->assertAuthenticated();

        $user->refresh();
        $this->assertEquals('newusername', $user->github_username);
        $this->assertEquals('Updated Name', $user->name);
    }

    public function test_github_callback_redirects_to_dashboard_when_user_has_orgs(): void
    {
        $user = User::factory()->create(['github_id' => 12345]);
        $org = Organization::factory()->create();
        $user->organizations()->attach($org->id, ['role' => 'admin']);

        $this->mockSocialiteUser([
            'id' => 12345,
            'nickname' => $user->github_username,
            'name' => $user->name,
            'email' => $user->email,
            'avatar' => $user->avatar_url,
            'token' => 'gho_test_token',
        ]);

        $response = $this->get('/auth/github/callback');

        $response->assertRedirect('/dashboard');
    }

    public function test_logout(): void
    {
        $user = User::factory()->create();

        $response = $this->actingAs($user)->post('/auth/logout');

        $response->assertRedirect('/');
        $this->assertGuest();
    }

    public function test_guest_cannot_access_dashboard(): void
    {
        $response = $this->get('/dashboard');

        $response->assertRedirect('/');
    }

    public function test_authenticated_user_cannot_access_github_redirect(): void
    {
        $user = User::factory()->create();

        $response = $this->actingAs($user)->get('/auth/github');

        $response->assertRedirect('/dashboard');
    }

    public function test_github_callback_handles_oauth_failure(): void
    {
        $provider = Mockery::mock(Provider::class);
        $provider->shouldReceive('user')->andThrow(new \Exception('OAuth error'));

        Socialite::shouldReceive('driver')
            ->with('github')
            ->andReturn($provider);

        $response = $this->get('/auth/github/callback');

        $response->assertRedirect('/');
        $response->assertSessionHas('error', 'GitHub authentication failed. Please try again.');
        $this->assertGuest();
    }

    public function test_github_callback_uses_noreply_email_when_email_is_null(): void
    {
        $socialiteUser = new SocialiteUser;
        $socialiteUser->id = 99999;
        $socialiteUser->nickname = 'nullemail';
        $socialiteUser->name = 'Null Email User';
        $socialiteUser->email = null;
        $socialiteUser->avatar = 'https://avatars.githubusercontent.com/u/99999';
        $socialiteUser->token = 'gho_test_token';

        $provider = Mockery::mock(Provider::class);
        $provider->shouldReceive('user')->andReturn($socialiteUser);

        Socialite::shouldReceive('driver')
            ->with('github')
            ->andReturn($provider);

        $response = $this->get('/auth/github/callback');

        $response->assertRedirect('/onboarding/organizations');
        $this->assertAuthenticated();
        $this->assertDatabaseHas('users', [
            'github_id' => 99999,
            'email' => '99999+nullemail@users.noreply.github.com',
        ]);
    }

    /**
     * @param  array{id: int, nickname: string, name: string, email: string, avatar: string, token: string}  $data
     */
    private function mockSocialiteUser(array $data): void
    {
        $socialiteUser = new SocialiteUser;
        $socialiteUser->id = $data['id'];
        $socialiteUser->nickname = $data['nickname'];
        $socialiteUser->name = $data['name'];
        $socialiteUser->email = $data['email'];
        $socialiteUser->avatar = $data['avatar'];
        $socialiteUser->token = $data['token'];

        $provider = Mockery::mock(Provider::class);
        $provider->shouldReceive('user')->andReturn($socialiteUser);

        Socialite::shouldReceive('driver')
            ->with('github')
            ->andReturn($provider);
    }
}
