<?php

namespace Database\Factories;

use App\Enums\LogLevel;
use App\Models\ReviewRun;
use App\Models\ReviewRunLog;
use Illuminate\Database\Eloquent\Factories\Factory;

/**
 * @extends Factory<ReviewRunLog>
 */
class ReviewRunLogFactory extends Factory
{
    protected $model = ReviewRunLog::class;

    /**
     * @return array<string, mixed>
     */
    public function definition(): array
    {
        return [
            'review_run_id' => ReviewRun::factory(),
            'level' => LogLevel::Info,
            'message' => fake()->sentence(),
            'metadata' => null,
            'logged_at' => now(),
        ];
    }

    public function warning(): static
    {
        return $this->state(fn (array $attributes) => [
            'level' => LogLevel::Warning,
        ]);
    }

    public function error(): static
    {
        return $this->state(fn (array $attributes) => [
            'level' => LogLevel::Error,
        ]);
    }
}
