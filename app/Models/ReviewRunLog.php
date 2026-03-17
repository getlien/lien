<?php

namespace App\Models;

use App\Enums\LogLevel;
use Illuminate\Database\Eloquent\Factories\HasFactory;
use Illuminate\Database\Eloquent\Model;
use Illuminate\Database\Eloquent\Relations\BelongsTo;

class ReviewRunLog extends Model
{
    /** @use HasFactory<\Database\Factories\ReviewRunLogFactory> */
    use HasFactory;

    const UPDATED_AT = null;

    protected $fillable = [
        'review_run_id',
        'level',
        'message',
        'metadata',
        'logged_at',
    ];

    /**
     * @return array<string, string>
     */
    protected function casts(): array
    {
        return [
            'level' => LogLevel::class,
            'metadata' => 'array',
            'logged_at' => 'datetime',
        ];
    }

    /**
     * @return BelongsTo<ReviewRun, $this>
     */
    public function reviewRun(): BelongsTo
    {
        return $this->belongsTo(ReviewRun::class);
    }
}
