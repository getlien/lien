<?php

namespace Tests\Unit;

use App\Models\Organization;
use App\Services\SubscriptionService;
use Illuminate\Foundation\Testing\RefreshDatabase;
use Tests\TestCase;

class SubscriptionServiceTest extends TestCase
{
    use RefreshDatabase;

    private SubscriptionService $service;

    protected function setUp(): void
    {
        parent::setUp();
        $this->service = new SubscriptionService;
    }

    public function test_returns_false_for_unknown_installation_id(): void
    {
        $this->assertFalse($this->service->isInstallActive(999_999));
    }

    public function test_returns_true_when_organization_is_on_trial(): void
    {
        $org = Organization::factory()->create([
            'github_installation_id' => 12345,
            'trial_ends_at' => now()->addDays(7),
        ]);

        $this->assertTrue($this->service->isInstallActive(12345));
        $this->assertTrue($this->service->isOrganizationActive($org));
    }

    public function test_returns_false_when_trial_expired_and_no_subscription(): void
    {
        $org = Organization::factory()->create([
            'github_installation_id' => 54321,
            'trial_ends_at' => now()->subDay(),
        ]);

        $this->assertFalse($this->service->isInstallActive(54321));
        $this->assertFalse($this->service->isOrganizationActive($org));
    }

    public function test_returns_true_when_subscription_active_even_after_trial(): void
    {
        $org = Organization::factory()->create([
            'github_installation_id' => 11111,
            'trial_ends_at' => now()->subDay(),
        ]);

        $org->subscriptions()->create([
            'type' => 'default',
            'stripe_id' => 'sub_test_active_'.uniqid(),
            'stripe_status' => 'active',
            'stripe_price' => 'price_test',
            'quantity' => 1,
        ]);

        $this->assertTrue($this->service->isInstallActive(11111));
    }
}
