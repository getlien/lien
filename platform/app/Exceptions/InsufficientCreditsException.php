<?php

namespace App\Exceptions;

use RuntimeException;

class InsufficientCreditsException extends RuntimeException
{
    public function __construct(int $organizationId)
    {
        parent::__construct("Organization {$organizationId} has insufficient credits to run a review.");
    }
}
