<?php

namespace App\Enums;

enum BillingMode: string
{
    case Credits = 'credits';
    case Byok = 'byok';
}
