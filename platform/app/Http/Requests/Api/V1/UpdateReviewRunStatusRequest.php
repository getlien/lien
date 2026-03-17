<?php

namespace App\Http\Requests\Api\V1;

use App\Enums\ReviewRunStatus;
use App\Models\ReviewRun;
use Illuminate\Foundation\Http\FormRequest;
use Illuminate\Validation\Rule;

class UpdateReviewRunStatusRequest extends FormRequest
{
    public function authorize(): bool
    {
        $claims = $this->attributes->get('jwt_claims');
        $reviewRun = $this->route('reviewRun');

        if (! $claims || ! $reviewRun instanceof ReviewRun) {
            return false;
        }

        if ($claims->repo !== $reviewRun->repository_id) {
            return false;
        }

        return $claims->rid === null || $claims->rid === $reviewRun->id;
    }

    /**
     * @return array<string, mixed>
     */
    public function rules(): array
    {
        return [
            'status' => ['required', Rule::enum(ReviewRunStatus::class)],
        ];
    }
}
