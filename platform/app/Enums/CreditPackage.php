<?php

namespace App\Enums;

enum CreditPackage: string
{
    case Starter = 'starter';
    case Growth = 'growth';
    case Scale = 'scale';

    public function credits(): int
    {
        return match ($this) {
            self::Starter => 100,
            self::Growth => 500,
            self::Scale => 2_000,
        };
    }

    public function priceInCents(): int
    {
        return match ($this) {
            self::Starter => 500,
            self::Growth => 2_000,
            self::Scale => 6_000,
        };
    }

    public function label(): string
    {
        return match ($this) {
            self::Starter => 'Starter',
            self::Growth => 'Growth',
            self::Scale => 'Scale',
        };
    }

    public function priceFormatted(): string
    {
        return '$'.number_format($this->priceInCents() / 100, 0);
    }

    public function perCreditFormatted(): string
    {
        return '$'.number_format($this->priceInCents() / 100 / $this->credits(), 2);
    }
}
