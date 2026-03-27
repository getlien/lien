<?php

namespace App\Services;

use App\Models\Repository;

class RepoConfigService
{
    /**
     * @return array<string, mixed>
     */
    public function getMergedConfig(Repository $repository): array
    {
        $org = $repository->organization;
        $repoOverrides = $repository->review_config ?? [];

        return [
            'plan' => $org->plan_tier->value,
            'billingMode' => $org->billing_mode->value,
            'creditBalance' => $org->credit_balance,
            'reviewTypes' => [
                'complexity' => [
                    'enabled' => data_get($repoOverrides, 'complexity.enabled', true),
                    'threshold' => data_get($repoOverrides, 'complexity.threshold', 15),
                    'deltaTracking' => data_get($repoOverrides, 'complexity.deltaTracking', true),
                ],
                'architectural' => [
                    'enabled' => data_get($repoOverrides, 'architectural.enabled', 'auto'),
                ],
                'summary' => [
                    'enabled' => data_get($repoOverrides, 'summary.enabled', true),
                ],
                'bugs' => [
                    'enabled' => data_get($repoOverrides, 'bugs.enabled', true),
                ],
            ],
            'complexityReviewsRemaining' => null,
            'managedLlmReviewsRemaining' => $org->isByok() ? null : $org->credit_balance,
            'llmSource' => $org->isByok() ? 'byok' : 'managed',
            'features' => [
                'orgManagement' => true,
                'customRules' => true,
                'trendRetentionDays' => null,
            ],
        ];
    }

    /**
     * Get config shaped for the NATS runner payload.
     *
     * @return array{threshold: string, review_types: array{complexity: bool, architectural: bool, summary: bool, bugs: bool}, block_on_new_errors: bool, architectural_mode: string}
     */
    public function getRunnerConfig(Repository $repository): array
    {
        $overrides = $repository->review_config ?? [];

        $rawArchMode = data_get($overrides, 'architectural.enabled', 'auto');
        $architecturalMode = $rawArchMode === 'disabled' ? 'off' : $rawArchMode;

        return [
            'threshold' => (string) data_get($overrides, 'complexity.threshold', 15),
            'review_types' => [
                'complexity' => (bool) data_get($overrides, 'complexity.enabled', true),
                'architectural' => $architecturalMode !== 'off',
                'summary' => (bool) data_get($overrides, 'summary.enabled', true),
                'bugs' => (bool) data_get($overrides, 'bugs.enabled', true),
            ],
            'block_on_new_errors' => false,
            'architectural_mode' => $architecturalMode,
        ];
    }
}
