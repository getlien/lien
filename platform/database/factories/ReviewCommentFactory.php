<?php

namespace Database\Factories;

use App\Enums\CommentResolution;
use App\Enums\ReviewCommentStatus;
use App\Models\ReviewComment;
use App\Models\ReviewRun;
use Illuminate\Database\Eloquent\Factories\Factory;

/**
 * @extends Factory<ReviewComment>
 */
class ReviewCommentFactory extends Factory
{
    protected $model = ReviewComment::class;

    /**
     * @return array<string, mixed>
     */
    public function definition(): array
    {
        return [
            'review_run_id' => ReviewRun::factory(),
            'review_type' => fake()->randomElement(['complexity', 'architectural']),
            'filepath' => 'src/'.fake()->word().'/'.fake()->word().'.ts',
            'line' => fake()->numberBetween(1, 500),
            'symbol_name' => fake()->optional(0.7)->passthrough(fake()->word().ucfirst(fake()->word())),
            'body' => fake()->paragraph(),
            'status' => ReviewCommentStatus::Posted,
            'github_comment_id' => fake()->optional(0.8)->randomNumber(9),
            'resolution' => null,
        ];
    }

    public function skipped(): static
    {
        return $this->state(fn (array $attributes) => [
            'status' => ReviewCommentStatus::Skipped,
            'github_comment_id' => null,
        ]);
    }

    public function suppressed(): static
    {
        return $this->state(fn (array $attributes) => [
            'status' => ReviewCommentStatus::Suppressed,
            'github_comment_id' => null,
        ]);
    }

    public function resolved(): static
    {
        return $this->state(fn (array $attributes) => [
            'resolution' => CommentResolution::Resolved,
        ]);
    }

    public function dismissed(): static
    {
        return $this->state(fn (array $attributes) => [
            'resolution' => CommentResolution::Dismissed,
        ]);
    }

    public function summary(): static
    {
        return $this->state(fn (array $attributes) => [
            'review_type' => 'summary',
            'filepath' => null,
            'line' => null,
        ]);
    }
}
