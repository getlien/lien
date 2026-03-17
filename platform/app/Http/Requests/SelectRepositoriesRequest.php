<?php

namespace App\Http\Requests;

use Illuminate\Foundation\Http\FormRequest;

class SelectRepositoriesRequest extends FormRequest
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
            'repositories' => ['required', 'array', 'min:1'],
            'repositories.*.id' => ['required', 'integer'],
            'repositories.*.full_name' => ['required', 'string'],
            'repositories.*.default_branch' => ['sometimes', 'string'],
            'repositories.*.private' => ['sometimes', 'boolean'],
        ];
    }
}
