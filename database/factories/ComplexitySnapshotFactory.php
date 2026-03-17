<?php

namespace Database\Factories;

use App\Enums\Severity;
use App\Models\ComplexitySnapshot;
use App\Models\Repository;
use App\Models\ReviewRun;
use Illuminate\Database\Eloquent\Factories\Factory;

/**
 * @extends Factory<ComplexitySnapshot>
 */
class ComplexitySnapshotFactory extends Factory
{
    protected $model = ComplexitySnapshot::class;

    /**
     * @return array<string, mixed>
     */
    public function definition(): array
    {
        $lineStart = fake()->numberBetween(1, 500);

        return [
            'review_run_id' => ReviewRun::factory(),
            'repository_id' => Repository::factory(),
            'filepath' => 'src/'.fake()->word().'/'.fake()->word().'.ts',
            'symbol_name' => fake()->word().ucfirst(fake()->word()),
            'symbol_type' => fake()->randomElement(['function', 'method', 'class']),
            'cyclomatic' => fake()->numberBetween(1, 30),
            'cognitive' => fake()->numberBetween(1, 40),
            'halstead_effort' => fake()->randomFloat(2, 10, 5000),
            'halstead_bugs' => fake()->randomFloat(4, 0.001, 2.0),
            'line_start' => $lineStart,
            'line_end' => $lineStart + fake()->numberBetween(5, 100),
            'delta_cyclomatic' => fake()->numberBetween(-5, 5),
            'delta_cognitive' => fake()->numberBetween(-5, 5),
            'severity' => Severity::None,
        ];
    }

    public function error(): static
    {
        return $this->state(fn (array $attributes) => [
            'severity' => Severity::Error,
            'cyclomatic' => fake()->numberBetween(20, 50),
            'cognitive' => fake()->numberBetween(25, 60),
        ]);
    }

    public function warning(): static
    {
        return $this->state(fn (array $attributes) => [
            'severity' => Severity::Warning,
            'cyclomatic' => fake()->numberBetween(10, 25),
            'cognitive' => fake()->numberBetween(12, 30),
        ]);
    }
}
