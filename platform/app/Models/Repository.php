<?php

namespace App\Models;

use Illuminate\Database\Eloquent\Builder;
use Illuminate\Database\Eloquent\Factories\HasFactory;
use Illuminate\Database\Eloquent\Model;
use Illuminate\Database\Eloquent\Relations\BelongsTo;
use Illuminate\Database\Eloquent\Relations\HasMany;

class Repository extends Model
{
    /** @use HasFactory<\Database\Factories\RepositoryFactory> */
    use HasFactory;

    protected $fillable = [
        'organization_id',
        'github_id',
        'full_name',
        'default_branch',
        'is_private',
        'review_config',
        'is_active',
    ];

    /**
     * @return array<string, string>
     */
    protected function casts(): array
    {
        return [
            'is_private' => 'boolean',
            'is_active' => 'boolean',
            'review_config' => 'array',
        ];
    }

    /**
     * @param  Builder<self>  $query
     * @return Builder<self>
     */
    public function scopeActive(Builder $query): Builder
    {
        return $query->where('is_active', true);
    }

    /**
     * @return BelongsTo<Organization, $this>
     */
    public function organization(): BelongsTo
    {
        return $this->belongsTo(Organization::class);
    }

    /**
     * @return HasMany<ReviewRun, $this>
     */
    public function reviewRuns(): HasMany
    {
        return $this->hasMany(ReviewRun::class);
    }

    /**
     * @return HasMany<ComplexitySnapshot, $this>
     */
    public function complexitySnapshots(): HasMany
    {
        return $this->hasMany(ComplexitySnapshot::class);
    }
}
