<?php

namespace App\Enums;

enum CommentResolution: string
{
    case Resolved = 'resolved';
    case Dismissed = 'dismissed';
    case AutoResolved = 'auto_resolved';
}
