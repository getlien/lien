<?php

namespace App\Providers;

use App\Services\GitHubAppService;
use App\Services\NatsService;
use App\Services\RunnerTokenService;
use Illuminate\Cache\RateLimiting\Limit;
use Illuminate\Http\Request;
use Illuminate\Support\Facades\RateLimiter;
use Illuminate\Support\ServiceProvider;

class AppServiceProvider extends ServiceProvider
{
    /**
     * Register any application services.
     */
    public function register(): void
    {
        $this->app->singleton(GitHubAppService::class, fn () => new GitHubAppService(
            appId: config('services.github_app.app_id') ?? '',
            privateKey: config('services.github_app.private_key') ?? '',
        ));

        $this->app->singleton(NatsService::class, fn () => new NatsService(
            host: config('services.nats.host'),
            port: config('services.nats.port'),
        ));

        $this->app->singleton(RunnerTokenService::class, function () {
            $signingKey = config('services.lien.service_token');

            if (! is_string($signingKey) || strlen($signingKey) < 32) {
                throw new \RuntimeException(
                    'LIEN_SERVICE_TOKEN must be configured with a key of at least 32 bytes.',
                );
            }

            return new RunnerTokenService(signingKey: $signingKey);
        });
    }

    /**
     * Bootstrap any application services.
     */
    public function boot(): void
    {
        RateLimiter::for('api', function (Request $request) {
            $authType = $request->attributes->get('auth_type');
            $key = $authType === 'service' ? 'service-token' : $request->ip();

            return [
                Limit::perMinute(120)->by($key),
                Limit::perHour(5000)->by($key),
            ];
        });
    }
}
