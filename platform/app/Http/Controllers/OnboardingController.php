<?php

namespace App\Http\Controllers;

use App\Http\Requests\SelectOrganizationRequest;
use App\Http\Requests\SelectRepositoriesRequest;
use App\Models\Organization;
use App\Models\Repository;
use App\Services\GitHubService;
use Illuminate\Http\RedirectResponse;
use Illuminate\Http\Request;
use Illuminate\Support\Str;
use Inertia\Inertia;
use Inertia\Response;

class OnboardingController extends Controller
{
    public function __construct(private GitHubService $github) {}

    public function showOrganizations(Request $request): Response
    {
        $orgs = $this->github->getOrganizations($request->user());

        return Inertia::render('Onboarding/SelectOrganization', [
            'organizations' => $orgs,
        ]);
    }

    public function selectOrganization(SelectOrganizationRequest $request): RedirectResponse
    {
        $validated = $request->validated();

        $userOrgs = $this->github->getOrganizations($request->user());
        $matchedOrg = collect($userOrgs)->firstWhere('login', $validated['login']);

        abort_unless($matchedOrg, 403, 'You are not a member of this organization.');

        $orgData = $this->github->getOrganization(
            $request->user(),
            $validated['login'],
        );

        $org = Organization::updateOrCreate(
            ['github_id' => $orgData['id']],
            [
                'name' => $orgData['name'] ?? $orgData['login'],
                'login' => $orgData['login'],
                'slug' => Str::slug($orgData['login']),
                'avatar_url' => $orgData['avatar_url'] ?? null,
            ],
        );

        if (! $request->user()->organizations()->where('organization_id', $org->id)->exists()) {
            $request->user()->organizations()->attach($org->id, ['role' => 'admin']);
        }

        session(['onboarding_org_id' => $org->id]);

        return redirect()->route('onboarding.repositories');
    }

    public function showRepositories(Request $request): Response|RedirectResponse
    {
        $orgId = session('onboarding_org_id');

        if (! $orgId) {
            return redirect()->route('onboarding.organizations');
        }

        $org = Organization::findOrFail($orgId);

        abort_unless(
            $request->user()->organizations()->where('organization_id', $org->id)->exists(),
            403,
        );

        $repos = $this->github->getOrganizationRepos(
            $request->user(),
            $org->login,
        );

        return Inertia::render('Onboarding/SelectRepositories', [
            'organization' => $org->only('id', 'name', 'slug', 'avatar_url'),
            'repositories' => $repos,
        ]);
    }

    public function selectRepositories(SelectRepositoriesRequest $request): RedirectResponse
    {
        $validated = $request->validated();
        $orgId = session('onboarding_org_id');

        if (! $orgId) {
            return redirect()->route('onboarding.organizations');
        }

        $org = Organization::findOrFail($orgId);

        abort_unless(
            $request->user()->organizations()->where('organization_id', $org->id)->exists(),
            403,
        );

        $githubRepos = $this->github->getOrganizationRepos($request->user(), $org->login);
        $validGithubIds = collect($githubRepos)->pluck('id')->all();

        $verifiedRepos = collect($validated['repositories'])
            ->filter(fn ($repo) => in_array($repo['id'], $validGithubIds, true));

        abort_if($verifiedRepos->isEmpty(), 422, 'None of the selected repositories belong to this organization.');

        Repository::upsert(
            $verifiedRepos->map(fn ($repo) => [
                'github_id' => $repo['id'],
                'organization_id' => $org->id,
                'full_name' => $repo['full_name'],
                'default_branch' => $repo['default_branch'] ?? 'main',
                'is_private' => $repo['private'] ?? false,
                'is_active' => true,
            ])->all(),
            ['github_id', 'organization_id'],
            ['full_name', 'default_branch', 'is_private', 'is_active'],
        );

        session()->forget('onboarding_org_id');

        return redirect()->route('dashboard');
    }
}
