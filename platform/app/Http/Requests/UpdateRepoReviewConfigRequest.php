<?php

namespace App\Http\Requests;

use Illuminate\Foundation\Http\FormRequest;

class UpdateRepoReviewConfigRequest extends FormRequest
{
    public function authorize(): bool
    {
        return true;
    }

    /**
     * @return array<string, array<int, string>>
     */
    public function rules(): array
    {
        return [
            'review_config' => ['required', 'array'],
            'review_config.complexity' => ['sometimes', 'array'],
            'review_config.complexity.enabled' => ['sometimes', 'boolean'],
            'review_config.complexity.threshold' => ['sometimes', 'integer', 'min:1', 'max:100'],
            'review_config.architectural' => ['sometimes', 'array'],
            'review_config.architectural.enabled' => ['sometimes', 'in:always,disabled,auto'],
            'review_config.summary' => ['sometimes', 'array'],
            'review_config.summary.enabled' => ['sometimes', 'boolean'],
            'review_config.bugs' => ['sometimes', 'array'],
            'review_config.bugs.enabled' => ['sometimes', 'boolean'],
        ];
    }
}
