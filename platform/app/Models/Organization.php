<?php

namespace App\Models;

use App\Enums\BillingMode;
use App\Enums\PlanTier;
use Illuminate\Database\Eloquent\Factories\HasFactory;
use Illuminate\Database\Eloquent\Model;
use Illuminate\Database\Eloquent\Relations\BelongsToMany;
use Illuminate\Database\Eloquent\Relations\HasMany;

class Organization extends Model
{
    /** @use HasFactory<\Database\Factories\OrganizationFactory> */
    use HasFactory;

    protected $fillable = [
        'github_id',
        'github_installation_id',
        'name',
        'login',
        'slug',
        'avatar_url',
        'plan_tier',
        'credit_balance',
        'billing_mode',
        'stripe_customer_id',
        'stripe_subscription_id',
        'byok_api_key',
        'byok_provider',
        'settings',
    ];

    /**
     * @return array<string, string>
     */
    protected function casts(): array
    {
        return [
            'plan_tier' => PlanTier::class,
            'billing_mode' => BillingMode::class,
            'credit_balance' => 'integer',
            'byok_api_key' => 'encrypted',
            'settings' => 'array',
        ];
    }

    /**
     * @return BelongsToMany<User, $this>
     */
    public function users(): BelongsToMany
    {
        return $this->belongsToMany(User::class)
            ->withPivot('role')
            ->withTimestamps();
    }

    /**
     * @return HasMany<Repository, $this>
     */
    public function repositories(): HasMany
    {
        return $this->hasMany(Repository::class);
    }

    /**
     * @return HasMany<CreditTransaction, $this>
     */
    public function creditTransactions(): HasMany
    {
        return $this->hasMany(CreditTransaction::class);
    }

    public function hasCredits(): bool
    {
        return $this->credit_balance > 0;
    }

    public function isByok(): bool
    {
        return $this->billing_mode === BillingMode::Byok;
    }

    public function canRunReview(): bool
    {
        return $this->isByok() || $this->hasCredits();
    }
}
