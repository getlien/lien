<?php

namespace App\Services;

use App\Models\Organization;

class SubscriptionService
{
    public function isInstallActive(int $installationId): bool
    {
        $organization = Organization::query()
            ->where('github_installation_id', $installationId)
            ->first();

        if ($organization === null) {
            return false;
        }

        return $this->isOrganizationActive($organization);
    }

    public function isOrganizationActive(Organization $organization): bool
    {
        return $organization->subscribed('default') || $organization->onTrial();
    }
}
