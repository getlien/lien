<?php

namespace App\Http\Requests\Api\V1;

use App\Enums\ReviewCommentStatus;
use App\Enums\ReviewRunStatus;
use App\Enums\Severity;
use Illuminate\Foundation\Http\FormRequest;
use Illuminate\Validation\Rule;

class StoreReviewRunRequest extends FormRequest
{
    public function authorize(): bool
    {
        $claims = $this->attributes->get('jwt_claims');

        if (! $claims) {
            return false;
        }

        $repoId = $this->input('repository_id', $this->input('repo_id'));

        if ($repoId === null || ! is_numeric($repoId)) {
            return true; // defer to validation rules for proper 422
        }

        return $claims->repo === (int) $repoId;
    }

    /**
     * Normalize runner field names to the canonical API field names before validation.
     * The runner sends: repo_id, start_line, complexity, plugin_id, message.
     * The API expects: repository_id, line_start, cyclomatic, review_type, body.
     */
    protected function prepareForValidation(): void
    {
        if ($this->has('repo_id')) {
            $this->merge(['repository_id' => $this->input('repo_id')]);
        }

        // Normalize head_sha: treat non-40-char values as null (runner falls back to branch name for repos with no parseable code)
        $headSha = $this->input('head_sha');
        if ($headSha !== null && strlen((string) $headSha) !== 40) {
            $this->merge(['head_sha' => null]);
        }

        if ($this->has('complexity_snapshots')) {
            $this->merge([
                'complexity_snapshots' => array_map(
                    fn (array $s) => array_merge($s, [
                        'line_start' => $s['start_line'] ?? null,
                        'cyclomatic' => isset($s['complexity']) ? (int) $s['complexity'] : null,
                        'cognitive' => isset($s['complexity']) ? (int) $s['complexity'] : null,
                    ]),
                    (array) $this->input('complexity_snapshots'),
                ),
            ]);
        }

        if ($this->has('review_comments')) {
            $this->merge([
                'review_comments' => array_map(
                    fn (array $c) => array_merge($c, [
                        'review_type' => $c['plugin_id'] ?? null,
                        'body' => $c['message'] ?? null,
                        'status' => $c['status'] ?? 'skipped',
                        'filepath' => ($c['filepath'] ?? null) !== '' ? ($c['filepath'] ?? null) : null,
                        'line' => (($line = (int) ($c['line'] ?? 0)) !== 0) ? $line : null,
                    ]),
                    (array) $this->input('review_comments'),
                ),
            ]);
        }
    }

    /**
     * @return array<string, mixed>
     */
    public function rules(): array
    {
        return [
            'repository_id' => ['required', 'integer', 'exists:repositories,id'],
            'pr_number' => ['nullable', 'integer', 'min:1'],
            'head_sha' => ['nullable', 'string', 'size:40'],
            'committed_at' => ['nullable', 'date'],
            'head_ref' => ['nullable', 'string', 'max:255'],
            'base_sha' => ['nullable', 'string', 'size:40'],
            'base_ref' => ['nullable', 'string', 'max:255'],
            'idempotency_key' => ['required', 'string', 'max:64'],
            'started_at' => ['nullable', 'date'],
            'completed_at' => ['nullable', 'date'],
            'status' => ['sometimes', Rule::enum(ReviewRunStatus::class)],
            'files_analyzed' => ['sometimes', 'integer', 'min:0'],
            'avg_complexity' => ['nullable', 'numeric', 'min:0'],
            'max_complexity' => ['nullable', 'numeric', 'min:0'],
            'token_usage' => ['sometimes', 'integer', 'min:0'],
            'cost' => ['sometimes', 'numeric', 'min:0'],
            'summary_comment_id' => ['nullable', 'integer'],

            'complexity_snapshots' => ['sometimes', 'array'],
            'complexity_snapshots.*.filepath' => ['required', 'string'],
            'complexity_snapshots.*.symbol_name' => ['required', 'string'],
            'complexity_snapshots.*.symbol_type' => ['required', 'string'],
            'complexity_snapshots.*.cyclomatic' => ['required', 'integer', 'min:0'],
            'complexity_snapshots.*.cognitive' => ['nullable', 'integer', 'min:0'],
            'complexity_snapshots.*.halstead_effort' => ['nullable', 'numeric'],
            'complexity_snapshots.*.halstead_bugs' => ['nullable', 'numeric'],
            'complexity_snapshots.*.line_start' => ['required', 'integer', 'min:1'],
            'complexity_snapshots.*.line_end' => ['nullable', 'integer', 'min:1'],
            'complexity_snapshots.*.delta_cyclomatic' => ['nullable', 'integer'],
            'complexity_snapshots.*.delta_cognitive' => ['nullable', 'integer'],
            'complexity_snapshots.*.severity' => ['sometimes', Rule::enum(Severity::class)],

            'review_comments' => ['sometimes', 'array'],
            'review_comments.*.review_type' => ['required', 'string'],
            'review_comments.*.filepath' => ['nullable', 'string', 'required_unless:review_comments.*.review_type,summary'],
            'review_comments.*.line' => ['nullable', 'integer', 'min:1'],
            'review_comments.*.symbol_name' => ['nullable', 'string'],
            'review_comments.*.body' => ['required', 'string'],
            'review_comments.*.category' => ['nullable', 'string', 'max:255'],
            'review_comments.*.status' => ['required', Rule::enum(ReviewCommentStatus::class)],
            'review_comments.*.github_comment_id' => ['nullable', 'integer'],
        ];
    }
}
