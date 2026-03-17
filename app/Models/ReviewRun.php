<?php

namespace App\Models;

use App\Enums\ReviewRunStatus;
use App\Enums\ReviewRunType;
use Illuminate\Database\Eloquent\Builder;
use Illuminate\Database\Eloquent\Factories\HasFactory;
use Illuminate\Database\Eloquent\Model;
use Illuminate\Database\Eloquent\Relations\BelongsTo;
use Illuminate\Database\Eloquent\Relations\HasMany;

class ReviewRun extends Model
{
    /** @use HasFactory<\Database\Factories\ReviewRunFactory> */
    use HasFactory;

    protected $fillable = [
        'repository_id',
        'type',
        'pr_number',
        'pr_title',
        'head_sha',
        'head_ref',
        'committed_at',
        'base_sha',
        'base_ref',
        'idempotency_key',
        'started_at',
        'completed_at',
        'status',
        'files_analyzed',
        'avg_complexity',
        'max_complexity',
        'token_usage',
        'cost',
        'summary_comment_id',
        'github_check_run_id',
    ];

    /**
     * @return array<string, string>
     */
    protected function casts(): array
    {
        return [
            'type' => ReviewRunType::class,
            'status' => ReviewRunStatus::class,
            'committed_at' => 'datetime',
            'started_at' => 'datetime',
            'completed_at' => 'datetime',
            'avg_complexity' => 'decimal:2',
            'max_complexity' => 'decimal:2',
            'cost' => 'decimal:6',
        ];
    }

    /**
     * @param  Builder<ReviewRun>  $query
     * @return Builder<ReviewRun>
     */
    public function scopeBaseline(Builder $query): Builder
    {
        return $query->where('type', ReviewRunType::Baseline);
    }

    /**
     * @param  Builder<ReviewRun>  $query
     * @return Builder<ReviewRun>
     */
    public function scopePr(Builder $query): Builder
    {
        return $query->where('type', ReviewRunType::Pr);
    }

    public function isBaseline(): bool
    {
        return $this->type === ReviewRunType::Baseline;
    }

    /**
     * @return BelongsTo<Repository, $this>
     */
    public function repository(): BelongsTo
    {
        return $this->belongsTo(Repository::class);
    }

    /**
     * @return HasMany<ComplexitySnapshot, $this>
     */
    public function complexitySnapshots(): HasMany
    {
        return $this->hasMany(ComplexitySnapshot::class);
    }

    /**
     * @return HasMany<ReviewComment, $this>
     */
    public function reviewComments(): HasMany
    {
        return $this->hasMany(ReviewComment::class);
    }

    /**
     * @return HasMany<ReviewRunLog, $this>
     */
    public function logs(): HasMany
    {
        return $this->hasMany(ReviewRunLog::class);
    }
}
