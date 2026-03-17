<?php

namespace App\Http\Requests\Api\V1;

use App\Models\Repository;
use Illuminate\Foundation\Http\FormRequest;

class ShowRepoConfigRequest extends FormRequest
{
    public function authorize(): bool
    {
        $claims = $this->attributes->get('jwt_claims');
        $repository = $this->route('repository');

        return $claims
            && $repository instanceof Repository
            && $claims->repo === $repository->id;
    }

    /**
     * @return array<string, mixed>
     */
    public function rules(): array
    {
        return [];
    }
}
