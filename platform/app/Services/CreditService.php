<?php

namespace App\Services;

use App\Enums\CreditPackage;
use App\Enums\CreditTransactionType;
use App\Exceptions\InsufficientCreditsException;
use App\Models\CreditTransaction;
use App\Models\Organization;
use App\Models\ReviewRun;
use Illuminate\Support\Facades\DB;

class CreditService
{
    public function grantInitialCredits(Organization $org): ?CreditTransaction
    {
        return DB::transaction(function () use ($org) {
            $org = Organization::lockForUpdate()->find($org->id);

            $alreadyGranted = CreditTransaction::query()
                ->where('organization_id', $org->id)
                ->where('type', CreditTransactionType::InitialGrant)
                ->exists();

            if ($alreadyGranted) {
                return null;
            }

            $org->increment('credit_balance', 5);

            return CreditTransaction::create([
                'organization_id' => $org->id,
                'type' => CreditTransactionType::InitialGrant,
                'amount' => 5,
                'balance_after' => $org->fresh()->credit_balance,
                'description' => 'Welcome credits',
            ]);
        });
    }

    public function deductCredit(Organization $org, ReviewRun $reviewRun): CreditTransaction
    {
        return DB::transaction(function () use ($org, $reviewRun) {
            $org = Organization::lockForUpdate()->find($org->id);

            if ($org->credit_balance < 1) {
                throw new InsufficientCreditsException($org->id);
            }

            $org->decrement('credit_balance');

            return CreditTransaction::create([
                'organization_id' => $org->id,
                'type' => CreditTransactionType::Deduction,
                'amount' => -1,
                'balance_after' => $org->fresh()->credit_balance,
                'description' => "Review run #{$reviewRun->id}",
                'review_run_id' => $reviewRun->id,
            ]);
        });
    }

    public function refundCredit(Organization $org, ReviewRun $reviewRun): ?CreditTransaction
    {
        return DB::transaction(function () use ($org, $reviewRun) {
            $alreadyRefunded = CreditTransaction::query()
                ->where('organization_id', $org->id)
                ->where('review_run_id', $reviewRun->id)
                ->where('type', CreditTransactionType::Refund)
                ->exists();

            if ($alreadyRefunded) {
                return null;
            }

            $org = Organization::lockForUpdate()->find($org->id);
            $org->increment('credit_balance');

            return CreditTransaction::create([
                'organization_id' => $org->id,
                'type' => CreditTransactionType::Refund,
                'amount' => 1,
                'balance_after' => $org->fresh()->credit_balance,
                'description' => "Refund for review run #{$reviewRun->id}",
                'review_run_id' => $reviewRun->id,
            ]);
        });
    }

    public function purchaseCredits(Organization $org, CreditPackage $package, string $stripePaymentIntentId): ?CreditTransaction
    {
        return DB::transaction(function () use ($org, $package, $stripePaymentIntentId) {
            $alreadyProcessed = CreditTransaction::query()
                ->where('stripe_payment_intent_id', $stripePaymentIntentId)
                ->exists();

            if ($alreadyProcessed) {
                return null;
            }

            $org = Organization::lockForUpdate()->find($org->id);
            $org->increment('credit_balance', $package->credits());

            return CreditTransaction::create([
                'organization_id' => $org->id,
                'type' => CreditTransactionType::Purchase,
                'amount' => $package->credits(),
                'balance_after' => $org->fresh()->credit_balance,
                'description' => "{$package->label()} pack ({$package->credits()} credits)",
                'stripe_payment_intent_id' => $stripePaymentIntentId,
            ]);
        });
    }
}
