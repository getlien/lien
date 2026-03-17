<?php

namespace App\Http\Requests\Api\V1;

use App\Enums\LogLevel;
use App\Models\ReviewRun;
use Illuminate\Foundation\Http\FormRequest;
use Illuminate\Validation\Rule;

class StoreReviewRunLogsRequest extends FormRequest
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
            'logs' => ['required', 'array', 'min:1', 'max:100'],
            'logs.*.level' => ['required', Rule::enum(LogLevel::class)],
            'logs.*.message' => ['required', 'string', 'max:2000'],
            'logs.*.metadata' => ['nullable', 'array'],
            'logs.*.logged_at' => ['required', 'date'],
        ];
    }
}
