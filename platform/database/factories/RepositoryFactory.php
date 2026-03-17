<?php

namespace Database\Factories;

use App\Models\Organization;
use App\Models\Repository;
use Illuminate\Database\Eloquent\Factories\Factory;

/**
 * @extends Factory<Repository>
 */
class RepositoryFactory extends Factory
{
    protected $model = Repository::class;

    /**
     * @return array<string, mixed>
     */
    public function definition(): array
    {
        $org = fake()->slug(1);
        $repo = fake()->slug(2);

        return [
            'organization_id' => Organization::factory(),
            'github_id' => fake()->unique()->randomNumber(8),
            'full_name' => "{$org}/{$repo}",
            'default_branch' => 'main',
            'is_private' => false,
            'review_config' => [],
            'is_active' => true,
        ];
    }

    public function private(): static
    {
        return $this->state(fn (array $attributes) => [
            'is_private' => true,
        ]);
    }

    public function inactive(): static
    {
        return $this->state(fn (array $attributes) => [
            'is_active' => false,
        ]);
    }
}
