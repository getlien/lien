<?php

namespace App\Enums;

enum ReviewCommentStatus: string
{
    case Posted = 'posted';
    case Skipped = 'skipped';
    case Suppressed = 'suppressed';
    case Deduped = 'deduped';
}
