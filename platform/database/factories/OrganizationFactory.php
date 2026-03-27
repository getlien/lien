<?php

namespace Database\Factories;

use App\Enums\BillingMode;
use App\Enums\PlanTier;
use App\Models\Organization;
use Illuminate\Database\Eloquent\Factories\Factory;
use Illuminate\Support\Str;

/**
 * @extends Factory<Organization>
 */
class OrganizationFactory extends Factory
{
    protected $model = Organization::class;

    /**
     * @return array<string, mixed>
     */
    public function definition(): array
    {
        $name = fake()->company();
        $login = Str::slug($name).'-'.fake()->unique()->randomNumber(4);

        return [
            'github_id' => fake()->unique()->randomNumber(8),
            'github_installation_id' => null,
            'name' => $name,
            'login' => $login,
            'slug' => $login,
            'avatar_url' => fake()->imageUrl(200, 200),
            'plan_tier' => PlanTier::Free,
            'settings' => [],
        ];
    }

    public function team(): static
    {
        return $this->state(fn (array $attributes) => [
            'plan_tier' => PlanTier::Team,
        ]);
    }

    public function business(): static
    {
        return $this->state(fn (array $attributes) => [
            'plan_tier' => PlanTier::Business,
        ]);
    }

    public function enterprise(): static
    {
        return $this->state(fn (array $attributes) => [
            'plan_tier' => PlanTier::Enterprise,
        ]);
    }

    public function withCredits(int $amount = 5): static
    {
        return $this->state(fn (array $attributes) => [
            'credit_balance' => $amount,
            'billing_mode' => BillingMode::Credits,
        ]);
    }

    public function byok(): static
    {
        return $this->state(fn (array $attributes) => [
            'billing_mode' => BillingMode::Byok,
            'byok_provider' => 'openrouter',
            'byok_api_key' => 'sk-test-byok-key-'.fake()->regexify('[a-zA-Z0-9]{24}'),
        ]);
    }
}
