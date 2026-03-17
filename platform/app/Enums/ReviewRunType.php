<?php

namespace App\Enums;

enum ReviewRunType: string
{
    case Baseline = 'baseline';
    case Pr = 'pr';
}
