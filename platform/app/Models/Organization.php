<?php

namespace App\Models;

use App\Enums\PlanTier;
use Illuminate\Database\Eloquent\Factories\HasFactory;
use Illuminate\Database\Eloquent\Model;
use Illuminate\Database\Eloquent\Relations\BelongsToMany;
use Illuminate\Database\Eloquent\Relations\HasMany;
use Laravel\Cashier\Billable;

class Organization extends Model
{
    /** @use HasFactory<\Database\Factories\OrganizationFactory> */
    use Billable, HasFactory;

    protected $fillable = [
        'github_id',
        'github_installation_id',
        'name',
        'login',
        'slug',
        'avatar_url',
        'plan_tier',
        'settings',
    ];

    /**
     * @return array<string, string>
     */
    protected function casts(): array
    {
        return [
            'plan_tier' => PlanTier::class,
            'settings' => 'array',
            'trial_ends_at' => 'datetime',
        ];
    }

    public function stripeName(): ?string
    {
        return $this->name;
    }

    protected static function booted(): void
    {
        static::creating(function (Organization $organization): void {
            if ($organization->trial_ends_at === null) {
                $organization->trial_ends_at = now()->addDays(14);
            }
        });
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
}
