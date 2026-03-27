<?php

namespace App\Enums;

enum CreditTransactionType: string
{
    case InitialGrant = 'initial_grant';
    case Purchase = 'purchase';
    case Deduction = 'deduction';
}
