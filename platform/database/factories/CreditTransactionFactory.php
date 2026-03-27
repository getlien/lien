<?php

namespace Database\Factories;

use App\Enums\CreditTransactionType;
use App\Models\CreditTransaction;
use App\Models\Organization;
use Illuminate\Database\Eloquent\Factories\Factory;

/**
 * @extends Factory<CreditTransaction>
 */
class CreditTransactionFactory extends Factory
{
    protected $model = CreditTransaction::class;

    /**
     * @return array<string, mixed>
     */
    public function definition(): array
    {
        return [
            'organization_id' => Organization::factory(),
            'type' => CreditTransactionType::Purchase,
            'amount' => 100,
            'balance_after' => 100,
            'description' => null,
            'review_run_id' => null,
            'stripe_payment_intent_id' => null,
            'created_by_user_id' => null,
        ];
    }

    public function initialGrant(): static
    {
        return $this->state(fn (array $attributes) => [
            'type' => CreditTransactionType::InitialGrant,
            'amount' => 5,
            'balance_after' => 5,
            'description' => 'Welcome credits',
        ]);
    }

    public function purchase(int $amount = 100): static
    {
        return $this->state(fn (array $attributes) => [
            'type' => CreditTransactionType::Purchase,
            'amount' => $amount,
            'stripe_payment_intent_id' => 'pi_'.fake()->unique()->regexify('[a-zA-Z0-9]{24}'),
        ]);
    }

    public function deduction(): static
    {
        return $this->state(fn (array $attributes) => [
            'type' => CreditTransactionType::Deduction,
            'amount' => -1,
            'description' => 'Review run',
        ]);
    }

    public function refund(): static
    {
        return $this->state(fn (array $attributes) => [
            'type' => CreditTransactionType::Refund,
            'amount' => 1,
            'description' => 'Refund — trivial PR',
        ]);
    }
}
