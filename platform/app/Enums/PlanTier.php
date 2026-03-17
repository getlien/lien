<?php

namespace App\Enums;

enum PlanTier: string
{
    case Free = 'free';
    case Solo = 'solo';
    case Team = 'team';
    case Business = 'business';
    case BusinessPlus = 'business_plus';
    case Enterprise = 'enterprise';
}
