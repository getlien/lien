<?php

namespace Database\Seeders;

use App\Enums\CommentResolution;
use App\Enums\ReviewRunStatus;
use App\Enums\Severity;
use App\Models\ComplexitySnapshot;
use App\Models\Organization;
use App\Models\Repository;
use App\Models\ReviewComment;
use App\Models\ReviewRun;
use App\Models\User;
use Illuminate\Database\Seeder;
use Illuminate\Support\Carbon;

class ComplexityTrendSeeder extends Seeder
{
    /**
     * Function definitions that persist across review runs for longitudinal tracking.
     *
     * @var list<array{filepath: string, symbol_name: string, symbol_type: string, base_cyclomatic: int, base_cognitive: int, line_start: int, line_end: int}>
     */
    private array $functions = [
        ['filepath' => 'src/services/auth.ts', 'symbol_name' => 'authenticateUser', 'symbol_type' => 'function', 'base_cyclomatic' => 8, 'base_cognitive' => 10, 'line_start' => 15, 'line_end' => 65],
        ['filepath' => 'src/services/auth.ts', 'symbol_name' => 'refreshToken', 'symbol_type' => 'function', 'base_cyclomatic' => 5, 'base_cognitive' => 6, 'line_start' => 70, 'line_end' => 110],
        ['filepath' => 'src/services/payment.ts', 'symbol_name' => 'processPayment', 'symbol_type' => 'function', 'base_cyclomatic' => 15, 'base_cognitive' => 18, 'line_start' => 22, 'line_end' => 120],
        ['filepath' => 'src/services/payment.ts', 'symbol_name' => 'validateCard', 'symbol_type' => 'function', 'base_cyclomatic' => 12, 'base_cognitive' => 14, 'line_start' => 125, 'line_end' => 200],
        ['filepath' => 'src/services/payment.ts', 'symbol_name' => 'calculateTax', 'symbol_type' => 'function', 'base_cyclomatic' => 6, 'base_cognitive' => 7, 'line_start' => 205, 'line_end' => 250],
        ['filepath' => 'src/controllers/user.ts', 'symbol_name' => 'handleRegistration', 'symbol_type' => 'function', 'base_cyclomatic' => 10, 'base_cognitive' => 12, 'line_start' => 30, 'line_end' => 95],
        ['filepath' => 'src/controllers/user.ts', 'symbol_name' => 'updateProfile', 'symbol_type' => 'method', 'base_cyclomatic' => 7, 'base_cognitive' => 8, 'line_start' => 100, 'line_end' => 150],
        ['filepath' => 'src/controllers/order.ts', 'symbol_name' => 'createOrder', 'symbol_type' => 'function', 'base_cyclomatic' => 18, 'base_cognitive' => 22, 'line_start' => 40, 'line_end' => 180],
        ['filepath' => 'src/controllers/order.ts', 'symbol_name' => 'cancelOrder', 'symbol_type' => 'function', 'base_cyclomatic' => 9, 'base_cognitive' => 11, 'line_start' => 185, 'line_end' => 240],
        ['filepath' => 'src/utils/validation.ts', 'symbol_name' => 'validateInput', 'symbol_type' => 'function', 'base_cyclomatic' => 14, 'base_cognitive' => 16, 'line_start' => 10, 'line_end' => 90],
        ['filepath' => 'src/utils/validation.ts', 'symbol_name' => 'sanitizeHtml', 'symbol_type' => 'function', 'base_cyclomatic' => 4, 'base_cognitive' => 5, 'line_start' => 95, 'line_end' => 130],
        ['filepath' => 'src/middleware/rateLimiter.ts', 'symbol_name' => 'checkRateLimit', 'symbol_type' => 'function', 'base_cyclomatic' => 11, 'base_cognitive' => 13, 'line_start' => 20, 'line_end' => 85],
        ['filepath' => 'src/middleware/cors.ts', 'symbol_name' => 'handleCors', 'symbol_type' => 'function', 'base_cyclomatic' => 6, 'base_cognitive' => 7, 'line_start' => 10, 'line_end' => 55],
        ['filepath' => 'src/models/User.ts', 'symbol_name' => 'toPublicJson', 'symbol_type' => 'method', 'base_cyclomatic' => 3, 'base_cognitive' => 3, 'line_start' => 45, 'line_end' => 70],
        ['filepath' => 'src/models/Order.ts', 'symbol_name' => 'calculateTotal', 'symbol_type' => 'method', 'base_cyclomatic' => 8, 'base_cognitive' => 9, 'line_start' => 50, 'line_end' => 100],
        ['filepath' => 'src/jobs/emailNotifier.ts', 'symbol_name' => 'sendNotification', 'symbol_type' => 'function', 'base_cyclomatic' => 7, 'base_cognitive' => 8, 'line_start' => 15, 'line_end' => 60],
        ['filepath' => 'src/jobs/dataSync.ts', 'symbol_name' => 'syncRecords', 'symbol_type' => 'function', 'base_cyclomatic' => 13, 'base_cognitive' => 16, 'line_start' => 20, 'line_end' => 120],
        ['filepath' => 'src/jobs/dataSync.ts', 'symbol_name' => 'resolveConflicts', 'symbol_type' => 'function', 'base_cyclomatic' => 16, 'base_cognitive' => 20, 'line_start' => 125, 'line_end' => 220],
        ['filepath' => 'src/api/router.ts', 'symbol_name' => 'configureRoutes', 'symbol_type' => 'function', 'base_cyclomatic' => 5, 'base_cognitive' => 4, 'line_start' => 10, 'line_end' => 80],
        ['filepath' => 'src/api/errorHandler.ts', 'symbol_name' => 'handleApiError', 'symbol_type' => 'function', 'base_cyclomatic' => 10, 'base_cognitive' => 12, 'line_start' => 15, 'line_end' => 75],
        ['filepath' => 'src/cache/manager.ts', 'symbol_name' => 'invalidateCache', 'symbol_type' => 'function', 'base_cyclomatic' => 7, 'base_cognitive' => 8, 'line_start' => 30, 'line_end' => 80],
        ['filepath' => 'src/cache/manager.ts', 'symbol_name' => 'warmCache', 'symbol_type' => 'function', 'base_cyclomatic' => 9, 'base_cognitive' => 11, 'line_start' => 85, 'line_end' => 150],
        ['filepath' => 'src/search/indexer.ts', 'symbol_name' => 'buildIndex', 'symbol_type' => 'function', 'base_cyclomatic' => 12, 'base_cognitive' => 15, 'line_start' => 25, 'line_end' => 130],
        ['filepath' => 'src/search/indexer.ts', 'symbol_name' => 'queryIndex', 'symbol_type' => 'function', 'base_cyclomatic' => 8, 'base_cognitive' => 10, 'line_start' => 135, 'line_end' => 200],
        ['filepath' => 'src/config/loader.ts', 'symbol_name' => 'loadConfig', 'symbol_type' => 'function', 'base_cyclomatic' => 6, 'base_cognitive' => 7, 'line_start' => 10, 'line_end' => 60],
    ];

    public function run(): void
    {
        $user = User::factory()->githubOnly()->create([
            'name' => 'Alf Henderson',
            'email' => 'alf@lien.dev',
            'github_id' => 12345678,
            'github_username' => 'alfhenderson',
        ]);

        $org = Organization::factory()->team()->create([
            'name' => 'Lien Dev',
            'slug' => 'liendev',
            'github_id' => 87654321,
        ]);

        $user->organizations()->attach($org->id, ['role' => 'admin']);

        $repos = collect([
            ['full_name' => 'liendev/lien', 'github_id' => 11111111],
            ['full_name' => 'liendev/lien-platform', 'github_id' => 22222222],
            ['full_name' => 'liendev/docs', 'github_id' => 33333333],
        ])->map(fn (array $data) => Repository::factory()->create([
            'organization_id' => $org->id,
            ...$data,
        ]));

        $startDate = Carbon::now()->subDays(60);

        foreach ($repos as $repo) {
            $this->seedReviewRunsForRepo($repo, $startDate);
        }
    }

    private function seedReviewRunsForRepo(Repository $repo, Carbon $startDate): void
    {
        $reviewTypes = ['complexity', 'architectural'];

        for ($i = 0; $i < 30; $i++) {
            $runDate = $startDate->copy()->addDays($i * 2)->addHours(fake()->numberBetween(8, 18));
            $prNumber = fake()->numberBetween(100, 500);

            $run = ReviewRun::factory()->create([
                'repository_id' => $repo->id,
                'pr_number' => $prNumber,
                'status' => ReviewRunStatus::Completed,
                'started_at' => $runDate->copy()->subMinutes(2),
                'completed_at' => $runDate,
                'created_at' => $runDate,
                'files_analyzed' => fake()->numberBetween(5, 30),
                'token_usage' => fake()->numberBetween(1000, 8000),
                'cost' => fake()->randomFloat(6, 0.02, 0.30),
            ]);

            $this->seedSnapshotsForRun($run, $repo, $i);
            $this->seedCommentsForRun($run, $reviewTypes);

            $avgComplexity = $run->complexitySnapshots()->avg('cyclomatic');
            $maxComplexity = $run->complexitySnapshots()->max('cyclomatic');
            $run->update([
                'avg_complexity' => $avgComplexity,
                'max_complexity' => $maxComplexity,
            ]);
        }
    }

    /**
     * @param  list<array{filepath: string, symbol_name: string, symbol_type: string, base_cyclomatic: int, base_cognitive: int, line_start: int, line_end: int}>  $functions
     */
    private function seedSnapshotsForRun(ReviewRun $run, Repository $repo, int $runIndex): void
    {
        $functionSubset = fake()->randomElements($this->functions, fake()->numberBetween(8, 15));

        foreach ($functionSubset as $func) {
            $drift = (int) round($runIndex * 0.15);
            $jitter = fake()->numberBetween(-2, 3);
            $cyclomatic = max(1, $func['base_cyclomatic'] + $drift + $jitter);
            $cognitive = max(1, $func['base_cognitive'] + $drift + $jitter);

            $severity = match (true) {
                $cyclomatic >= 20 => Severity::Error,
                $cyclomatic >= 10 => Severity::Warning,
                default => Severity::None,
            };

            ComplexitySnapshot::factory()->create([
                'review_run_id' => $run->id,
                'repository_id' => $repo->id,
                'filepath' => $func['filepath'],
                'symbol_name' => $func['symbol_name'],
                'symbol_type' => $func['symbol_type'],
                'cyclomatic' => $cyclomatic,
                'cognitive' => $cognitive,
                'halstead_effort' => $cyclomatic * fake()->randomFloat(2, 50, 150),
                'halstead_bugs' => $cyclomatic * fake()->randomFloat(4, 0.01, 0.05),
                'line_start' => $func['line_start'],
                'line_end' => $func['line_end'],
                'delta_cyclomatic' => $runIndex > 0 ? fake()->numberBetween(-2, 3) : null,
                'delta_cognitive' => $runIndex > 0 ? fake()->numberBetween(-2, 3) : null,
                'severity' => $severity,
                'created_at' => $run->completed_at,
            ]);
        }
    }

    /**
     * @param  list<string>  $reviewTypes
     */
    private function seedCommentsForRun(ReviewRun $run, array $reviewTypes): void
    {
        $commentCount = fake()->numberBetween(1, 6);

        for ($j = 0; $j < $commentCount; $j++) {
            $resolution = fake()->optional(0.6)->randomElement([
                CommentResolution::Resolved,
                CommentResolution::Resolved,
                CommentResolution::Dismissed,
            ]);

            ReviewComment::factory()->create([
                'review_run_id' => $run->id,
                'review_type' => fake()->randomElement($reviewTypes),
                'resolution' => $resolution,
                'created_at' => $run->completed_at,
            ]);
        }
    }
}
