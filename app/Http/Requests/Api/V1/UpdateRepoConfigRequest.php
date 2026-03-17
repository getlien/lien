<?php

namespace App\Http\Requests\Api\V1;

use App\Http\Requests\UpdateRepoReviewConfigRequest;
use App\Models\Repository;

class UpdateRepoConfigRequest extends UpdateRepoReviewConfigRequest
{
    public function authorize(): bool
    {
        $claims = $this->attributes->get('jwt_claims');
        $repository = $this->route('repository');

        return $claims
            && $repository instanceof Repository
            && $claims->repo === $repository->id;
    }
}
