<?php

namespace App\Http\Controllers\Auth;

use App\Http\Controllers\Controller;
use App\Models\User;
use Illuminate\Http\RedirectResponse;
use Illuminate\Http\Request;
use Illuminate\Support\Facades\Auth;
use Illuminate\Support\Facades\Log;
use Laravel\Socialite\Facades\Socialite;

class GitHubAuthController extends Controller
{
    public function redirect(): RedirectResponse
    {
        return Socialite::driver('github')
            ->scopes(['read:org', 'user:email'])
            ->redirect();
    }

    public function callback(Request $request): RedirectResponse
    {
        try {
            $githubUser = Socialite::driver('github')->user();
        } catch (\Exception $e) {
            Log::warning('GitHub OAuth callback failed', ['error' => $e->getMessage()]);

            return redirect()->route('home')->with('error', 'GitHub authentication failed. Please try again.');
        }

        $email = $githubUser->getEmail()
            ?? $githubUser->getId().'+'.$githubUser->getNickname().'@users.noreply.github.com';

        $user = User::updateOrCreate(
            ['github_id' => $githubUser->getId()],
            [
                'name' => $githubUser->getName() ?? $githubUser->getNickname(),
                'email' => $email,
                'github_username' => $githubUser->getNickname(),
                'avatar_url' => $githubUser->getAvatar(),
                'github_token' => $githubUser->token,
                'email_verified_at' => now(),
            ],
        );

        Auth::login($user, remember: true);
        $request->session()->regenerate();

        if ($user->organizations()->count() === 0) {
            return redirect()->route('onboarding.organizations');
        }

        return redirect()->route('dashboard');
    }

    public function logout(Request $request): RedirectResponse
    {
        Auth::logout();

        $request->session()->invalidate();
        $request->session()->regenerateToken();

        return redirect()->route('home');
    }
}
