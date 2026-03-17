<?php

namespace App\Policies;

use App\Models\Organization;
use App\Models\User;

class OrganizationPolicy
{
    public function view(User $user, Organization $organization): bool
    {
        return $user->organizations()->where('organization_id', $organization->id)->exists();
    }

    public function manage(User $user, Organization $organization): bool
    {
        return $user->organizations()
            ->where('organization_id', $organization->id)
            ->wherePivot('role', 'admin')
            ->exists();
    }
}
