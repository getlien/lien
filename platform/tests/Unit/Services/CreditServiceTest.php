<?php

namespace Tests\Unit\Services;

use App\Enums\CreditPackage;
use App\Enums\CreditTransactionType;
use App\Models\CreditTransaction;
use App\Models\Organization;
use App\Models\Repository;
use App\Models\ReviewRun;
use App\Services\CreditService;
use Illuminate\Foundation\Testing\RefreshDatabase;
use Tests\TestCase;

class CreditServiceTest extends TestCase
{
    use RefreshDatabase;

    private CreditService $creditService;

    protected function setUp(): void
    {
        parent::setUp();
        $this->creditService = new CreditService;
    }

    public function test_grants_initial_credits_to_new_org(): void
    {
        $org = Organization::factory()->withCredits(0)->create();

        $tx = $this->creditService->grantInitialCredits($org);

        $this->assertNotNull($tx);
        $this->assertEquals(CreditTransactionType::InitialGrant, $tx->type);
        $this->assertEquals(5, $tx->amount);
        $this->assertEquals(5, $tx->balance_after);

        $org->refresh();
        $this->assertEquals(5, $org->credit_balance);
    }

    public function test_initial_grant_is_idempotent(): void
    {
        $org = Organization::factory()->withCredits(0)->create();

        $tx1 = $this->creditService->grantInitialCredits($org);
        $tx2 = $this->creditService->grantInitialCredits($org);

        $this->assertNotNull($tx1);
        $this->assertNull($tx2);

        $org->refresh();
        $this->assertEquals(5, $org->credit_balance);

        $this->assertEquals(1, CreditTransaction::where('organization_id', $org->id)
            ->where('type', CreditTransactionType::InitialGrant)
            ->count());
    }

    public function test_deducts_credit_and_records_transaction(): void
    {
        $org = Organization::factory()->withCredits(10)->create();
        $repo = Repository::factory()->create(['organization_id' => $org->id]);
        $run = ReviewRun::factory()->create(['repository_id' => $repo->id]);

        $tx = $this->creditService->deductCredit($org, $run);

        $this->assertEquals(CreditTransactionType::Deduction, $tx->type);
        $this->assertEquals(-1, $tx->amount);
        $this->assertEquals(9, $tx->balance_after);
        $this->assertEquals($run->id, $tx->review_run_id);

        $org->refresh();
        $this->assertEquals(9, $org->credit_balance);
    }

    public function test_deduction_allows_negative_balance(): void
    {
        $org = Organization::factory()->withCredits(0)->create();
        $repo = Repository::factory()->create(['organization_id' => $org->id]);
        $run = ReviewRun::factory()->create(['repository_id' => $repo->id]);

        $tx = $this->creditService->deductCredit($org, $run);

        $this->assertEquals(-1, $tx->amount);
        $this->assertEquals(-1, $tx->balance_after);

        $org->refresh();
        $this->assertEquals(-1, $org->credit_balance);
    }

    public function test_deduction_is_idempotent_per_review_run(): void
    {
        $org = Organization::factory()->withCredits(10)->create();
        $repo = Repository::factory()->create(['organization_id' => $org->id]);
        $run = ReviewRun::factory()->create(['repository_id' => $repo->id]);

        $tx1 = $this->creditService->deductCredit($org, $run);
        $tx2 = $this->creditService->deductCredit($org, $run);

        $this->assertEquals($tx1->id, $tx2->id);

        $org->refresh();
        $this->assertEquals(9, $org->credit_balance);

        $this->assertEquals(1, CreditTransaction::where('organization_id', $org->id)
            ->where('review_run_id', $run->id)
            ->where('type', CreditTransactionType::Deduction)
            ->count());
    }

    public function test_purchase_increments_balance_and_records_transaction(): void
    {
        $org = Organization::factory()->withCredits(5)->create();

        $tx = $this->creditService->purchaseCredits(
            $org,
            CreditPackage::Starter,
            'pi_test_abc123',
        );

        $this->assertNotNull($tx);
        $this->assertEquals(CreditTransactionType::Purchase, $tx->type);
        $this->assertEquals(100, $tx->amount);
        $this->assertEquals(105, $tx->balance_after);
        $this->assertEquals('pi_test_abc123', $tx->stripe_payment_intent_id);

        $org->refresh();
        $this->assertEquals(105, $org->credit_balance);
    }

    public function test_purchase_is_idempotent_on_stripe_payment_intent(): void
    {
        $org = Organization::factory()->withCredits(5)->create();

        $tx1 = $this->creditService->purchaseCredits(
            $org,
            CreditPackage::Starter,
            'pi_test_duplicate',
        );
        $tx2 = $this->creditService->purchaseCredits(
            $org,
            CreditPackage::Starter,
            'pi_test_duplicate',
        );

        $this->assertNotNull($tx1);
        $this->assertNull($tx2);

        $org->refresh();
        $this->assertEquals(105, $org->credit_balance);
    }

    public function test_purchase_growth_pack(): void
    {
        $org = Organization::factory()->withCredits(0)->create();

        $tx = $this->creditService->purchaseCredits(
            $org,
            CreditPackage::Growth,
            'pi_test_growth',
        );

        $this->assertEquals(500, $tx->amount);
        $this->assertEquals(500, $tx->balance_after);

        $org->refresh();
        $this->assertEquals(500, $org->credit_balance);
    }

    public function test_purchase_scale_pack(): void
    {
        $org = Organization::factory()->withCredits(0)->create();

        $tx = $this->creditService->purchaseCredits(
            $org,
            CreditPackage::Scale,
            'pi_test_scale',
        );

        $this->assertEquals(2000, $tx->amount);
        $this->assertEquals(2000, $tx->balance_after);

        $org->refresh();
        $this->assertEquals(2000, $org->credit_balance);
    }

    public function test_purchase_recovers_negative_balance(): void
    {
        $org = Organization::factory()->withCredits(-3)->create();

        $tx = $this->creditService->purchaseCredits(
            $org,
            CreditPackage::Starter,
            'pi_test_recovery',
        );

        $this->assertEquals(100, $tx->amount);
        $this->assertEquals(97, $tx->balance_after);

        $org->refresh();
        $this->assertEquals(97, $org->credit_balance);
    }
}
