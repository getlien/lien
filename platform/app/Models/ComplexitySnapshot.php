<?php

namespace App\Models;

use App\Enums\Severity;
use Illuminate\Database\Eloquent\Factories\HasFactory;
use Illuminate\Database\Eloquent\Model;
use Illuminate\Database\Eloquent\Relations\BelongsTo;

class ComplexitySnapshot extends Model
{
    /** @use HasFactory<\Database\Factories\ComplexitySnapshotFactory> */
    use HasFactory;

    const UPDATED_AT = null;

    protected $fillable = [
        'review_run_id',
        'repository_id',
        'filepath',
        'symbol_name',
        'symbol_type',
        'cyclomatic',
        'cognitive',
        'halstead_effort',
        'halstead_bugs',
        'line_start',
        'line_end',
        'delta_cyclomatic',
        'delta_cognitive',
        'severity',
    ];

    /**
     * @return array<string, string>
     */
    protected function casts(): array
    {
        return [
            'severity' => Severity::class,
            'halstead_effort' => 'decimal:2',
            'halstead_bugs' => 'decimal:4',
        ];
    }

    /**
     * @return BelongsTo<ReviewRun, $this>
     */
    public function reviewRun(): BelongsTo
    {
        return $this->belongsTo(ReviewRun::class);
    }

    /**
     * @return BelongsTo<Repository, $this>
     */
    public function repository(): BelongsTo
    {
        return $this->belongsTo(Repository::class);
    }
}
