<?php

namespace App\Models;

use App\Enums\CommentResolution;
use App\Enums\ReviewCommentStatus;
use Illuminate\Database\Eloquent\Factories\HasFactory;
use Illuminate\Database\Eloquent\Model;
use Illuminate\Database\Eloquent\Relations\BelongsTo;

class ReviewComment extends Model
{
    /** @use HasFactory<\Database\Factories\ReviewCommentFactory> */
    use HasFactory;

    protected $fillable = [
        'review_run_id',
        'review_type',
        'filepath',
        'line',
        'symbol_name',
        'body',
        'category',
        'status',
        'github_comment_id',
        'resolution',
        'fingerprint',
    ];

    /**
     * @return array<string, string>
     */
    protected function casts(): array
    {
        return [
            'status' => ReviewCommentStatus::class,
            'resolution' => CommentResolution::class,
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
