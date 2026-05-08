<?php

namespace App\Http\Controllers;

use App\Models\Organization;
use Illuminate\Http\RedirectResponse;
use Illuminate\Http\Request;
use Inertia\Inertia;
use Inertia\Response;

class BillingController extends Controller
{
    public function show(Request $request): Response
    {
        $organization = $this->resolveOrganization($request);
        $subscription = $organization->subscription('default');

        return Inertia::render('Billing', [
            'organization' => [
                'id' => $organization->id,
                'name' => $organization->name,
                'avatar_url' => $organization->avatar_url,
            ],
            'subscription' => [
                'state' => $this->resolveState($organization),
                'trial_ends_at' => optional($organization->trial_ends_at)->toIso8601String(),
                'on_trial' => $organization->onTrial(),
                'on_grace_period' => $subscription?->onGracePeriod() ?? false,
                'ends_at' => optional($subscription?->ends_at)->toIso8601String(),
                'stripe_status' => $subscription?->stripe_status,
            ],
        ]);
    }

    public function checkout(Request $request): RedirectResponse
    {
        $organization = $this->resolveOrganization($request);
        $priceId = config('services.stripe.price_id');

        if (! is_string($priceId) || $priceId === '') {
            abort(503, 'Billing is not configured.');
        }

        $checkout = $organization
            ->newSubscription('default', $priceId)
            ->checkout([
                'success_url' => route('billing').'?checkout=success',
                'cancel_url' => route('billing').'?checkout=cancelled',
            ]);

        return redirect($checkout->url);
    }

    public function portal(Request $request): RedirectResponse
    {
        $organization = $this->resolveOrganization($request);

        if (! $organization->hasStripeId()) {
            return redirect()->route('billing');
        }

        return $organization->redirectToBillingPortal(route('billing'));
    }

    private function resolveOrganization(Request $request): Organization
    {
        $organization = $request->user()
            ->organizations()
            ->orderBy('organizations.created_at')
            ->first();

        if ($organization === null) {
            abort(404, 'No organization found for this account.');
        }

        return $organization;
    }

    private function resolveState(Organization $organization): string
    {
        if ($organization->subscribed('default')) {
            return 'active';
        }

        if ($organization->onTrial()) {
            return 'trialing';
        }

        return 'none';
    }
}
