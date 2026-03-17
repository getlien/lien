<?php

namespace App\Http\Middleware;

use Illuminate\Http\Request;
use Inertia\Middleware;

class HandleInertiaRequests extends Middleware
{
    /**
     * The root template that's loaded on the first page visit.
     *
     * @see https://inertiajs.com/server-side-setup#root-template
     *
     * @var string
     */
    protected $rootView = 'app';

    /**
     * Determines the current asset version.
     *
     * @see https://inertiajs.com/asset-versioning
     */
    public function version(Request $request): ?string
    {
        return parent::version($request);
    }

    /**
     * Define the props that are shared by default.
     *
     * @see https://inertiajs.com/shared-data
     *
     * @return array<string, mixed>
     */
    public function share(Request $request): array
    {
        return [
            ...parent::share($request),
            'auth' => [
                'user' => fn () => $request->user()
                    ? $request->user()->only('id', 'name', 'email', 'github_username', 'avatar_url')
                    : null,
            ],
            'sidebar' => fn () => $request->user()
                ? $request->user()
                    ->organizations()
                    ->with(['repositories' => fn ($q) => $q->active()->select('id', 'organization_id', 'full_name')->orderBy('full_name')])
                    ->get(['id', 'name', 'slug', 'avatar_url'])
                    ->map(fn ($org) => [
                        'id' => $org->id,
                        'name' => $org->name,
                        'slug' => $org->slug,
                        'avatar_url' => $org->avatar_url,
                        'repositories' => $org->repositories->map(fn ($repo) => [
                            'id' => $repo->id,
                            'full_name' => $repo->full_name,
                        ]),
                    ])
                : null,
            'flash' => [],
        ];
    }
}
