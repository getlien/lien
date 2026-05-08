<?php

namespace Tests\Feature;

use App\Models\Organization;
use App\Models\User;
use Illuminate\Foundation\Testing\RefreshDatabase;
use Tests\TestCase;

class BillingControllerTest extends TestCase
{
    use RefreshDatabase;

    public function test_show_page_renders_for_user_with_org(): void
    {
        $user = User::factory()->create();
        $org = Organization::factory()->create(['trial_ends_at' => now()->addDays(7)]);
        $user->organizations()->attach($org->id, ['role' => 'admin']);

        $response = $this->actingAs($user)->get('/billing');

        $response->assertOk();
        $response->assertInertia(fn ($page) => $page
            ->component('Billing')
            ->where('subscription.state', 'trialing')
            ->where('subscription.on_trial', true)
            ->where('organization.id', $org->id)
        );
    }

    public function test_show_returns_none_state_when_trial_expired(): void
    {
        $user = User::factory()->create();
        $org = Organization::factory()->create(['trial_ends_at' => now()->subDay()]);
        $user->organizations()->attach($org->id, ['role' => 'admin']);

        $response = $this->actingAs($user)->get('/billing');

        $response->assertOk();
        $response->assertInertia(fn ($page) => $page
            ->where('subscription.state', 'none')
            ->where('subscription.on_trial', false)
        );
    }

    public function test_guest_cannot_access_billing(): void
    {
        $this->get('/billing')->assertRedirect('/');
    }

    public function test_user_without_organization_gets_404(): void
    {
        $user = User::factory()->create();

        $this->actingAs($user)->get('/billing')->assertNotFound();
    }

    public function test_checkout_aborts_when_price_id_missing(): void
    {
        config(['services.stripe.price_id' => null]);

        $user = User::factory()->create();
        $org = Organization::factory()->create();
        $user->organizations()->attach($org->id, ['role' => 'admin']);

        $this->actingAs($user)->post('/billing/checkout')->assertStatus(503);
    }

    public function test_portal_redirects_to_billing_when_no_stripe_id(): void
    {
        $user = User::factory()->create();
        $org = Organization::factory()->create(['stripe_id' => null]);
        $user->organizations()->attach($org->id, ['role' => 'admin']);

        $this->actingAs($user)->get('/billing/portal')->assertRedirect('/billing');
    }
}
