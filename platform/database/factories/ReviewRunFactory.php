<?php

namespace Database\Factories;

use App\Enums\ReviewRunStatus;
use App\Enums\ReviewRunType;
use App\Models\Repository;
use App\Models\ReviewRun;
use Illuminate\Database\Eloquent\Factories\Factory;
use Illuminate\Support\Str;

/**
 * @extends Factory<ReviewRun>
 */
class ReviewRunFactory extends Factory
{
    protected $model = ReviewRun::class;

    /**
     * @return array<string, mixed>
     */
    public function definition(): array
    {
        $headSha = fake()->sha1().fake()->lexify('????????');
        $baseSha = fake()->sha1().fake()->lexify('????????');

        return [
            'repository_id' => Repository::factory(),
            'type' => ReviewRunType::Pr,
            'pr_number' => fake()->numberBetween(1, 500),
            'pr_title' => fake()->sentence(4),
            'head_sha' => substr($headSha, 0, 40),
            'committed_at' => null,
            'base_sha' => substr($baseSha, 0, 40),
            'idempotency_key' => Str::random(64),
            'started_at' => now()->subMinutes(5),
            'completed_at' => now(),
            'status' => ReviewRunStatus::Completed,
            'files_analyzed' => fake()->numberBetween(1, 50),
            'avg_complexity' => fake()->randomFloat(2, 2, 25),
            'max_complexity' => fake()->randomFloat(2, 10, 50),
            'token_usage' => fake()->numberBetween(500, 10000),
            'cost' => fake()->randomFloat(6, 0.01, 0.50),
            'summary_comment_id' => null,
        ];
    }

    public function pending(): static
    {
        return $this->state(fn (array $attributes) => [
            'status' => ReviewRunStatus::Pending,
            'started_at' => null,
            'completed_at' => null,
            'files_analyzed' => 0,
            'avg_complexity' => null,
            'max_complexity' => null,
            'token_usage' => 0,
            'cost' => 0,
        ]);
    }

    public function running(): static
    {
        return $this->state(fn (array $attributes) => [
            'status' => ReviewRunStatus::Running,
            'started_at' => now()->subMinutes(2),
            'completed_at' => null,
        ]);
    }

    public function failed(): static
    {
        return $this->state(fn (array $attributes) => [
            'status' => ReviewRunStatus::Failed,
            'started_at' => now()->subMinutes(3),
            'completed_at' => now(),
        ]);
    }

    public function baseline(): static
    {
        return $this->state(fn (array $attributes) => [
            'type' => ReviewRunType::Baseline,
            'pr_number' => null,
            'pr_title' => null,
            'base_sha' => null,
            'committed_at' => now()->subMinutes(10),
        ]);
    }
}
