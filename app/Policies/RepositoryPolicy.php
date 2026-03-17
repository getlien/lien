<?php

namespace App\Policies;

use App\Models\Repository;
use App\Models\User;

class RepositoryPolicy
{
    public function view(User $user, Repository $repository): bool
    {
        return $user->organizations()->where('organization_id', $repository->organization_id)->exists();
    }

    public function update(User $user, Repository $repository): bool
    {
        return $user->organizations()
            ->where('organization_id', $repository->organization_id)
            ->wherePivot('role', 'admin')
            ->exists();
    }
}
