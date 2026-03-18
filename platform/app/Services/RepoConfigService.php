<?php

namespace App\Services;

use App\Enums\PlanTier;
use App\Models\Repository;

class RepoConfigService
{
    /**
     * @return array<string, mixed>
     */
    public function getMergedConfig(Repository $repository): array
    {
        $org = $repository->organization;
        $planDefaults = $this->getPlanDefaults($org->plan_tier);
        $repoOverrides = $repository->review_config ?? [];

        return [
            'plan' => $org->plan_tier->value,
            'reviewTypes' => [
                'complexity' => [
                    'enabled' => data_get($repoOverrides, 'complexity.enabled', true),
                    'threshold' => data_get($repoOverrides, 'complexity.threshold', 15),
                    'deltaTracking' => data_get($repoOverrides, 'complexity.deltaTracking', true),
                ],
                'architectural' => [
                    'enabled' => data_get($repoOverrides, 'architectural.enabled', $planDefaults['architectural_default']),
                ],
                'summary' => [
                    'enabled' => data_get($repoOverrides, 'summary.enabled', true),
                ],
                'bugs' => [
                    'enabled' => data_get($repoOverrides, 'bugs.enabled', $planDefaults['bugs_default'] ?? false),
                ],
            ],
            'complexityReviewsRemaining' => null,
            'managedLlmReviewsRemaining' => $planDefaults['managed_llm_reviews'],
            'llmSource' => $planDefaults['llm_source'],
            'features' => $planDefaults['features'],
        ];
    }

    /**
     * Get config shaped for the NATS runner payload.
     *
     * @return array{threshold: string, review_types: array{complexity: bool, architectural: bool, summary: bool, bugs: bool}, block_on_new_errors: bool, architectural_mode: string}
     */
    public function getRunnerConfig(Repository $repository): array
    {
        $org = $repository->organization;
        $planDefault = $this->getPlanDefaults($org->plan_tier)['architectural_default'];
        $overrides = $repository->review_config ?? [];

        $rawArchMode = data_get($overrides, 'architectural.enabled', $planDefault);
        $architecturalMode = $rawArchMode === 'disabled' ? 'off' : $rawArchMode;

        return [
            'threshold' => (string) data_get($overrides, 'complexity.threshold', 15),
            'review_types' => [
                'complexity' => (bool) data_get($overrides, 'complexity.enabled', true),
                'architectural' => $architecturalMode !== 'off',
                'summary' => (bool) data_get($overrides, 'summary.enabled', true),
                'bugs' => (bool) data_get($overrides, 'bugs.enabled', $this->getPlanDefaults($org->plan_tier)['bugs_default'] ?? false),
            ],
            'block_on_new_errors' => false,
            'architectural_mode' => $architecturalMode,
        ];
    }

    /**
     * @return array{managed_llm_reviews: int|null, llm_source: string, architectural_default: string, features: array<string, mixed>}
     */
    private function getPlanDefaults(PlanTier $tier): array
    {
        return match ($tier) {
            PlanTier::Free => [
                'managed_llm_reviews' => 5,
                'llm_source' => 'managed',
                'architectural_default' => 'disabled',
                'bugs_default' => false,
                'features' => [
                    'orgManagement' => false,
                    'customRules' => false,
                    'trendRetentionDays' => 30,
                ],
            ],
            PlanTier::Solo => [
                'managed_llm_reviews' => 25,
                'llm_source' => 'managed',
                'architectural_default' => 'auto',
                'bugs_default' => false,
                'features' => [
                    'orgManagement' => false,
                    'customRules' => false,
                    'trendRetentionDays' => 90,
                ],
            ],
            PlanTier::Team => [
                'managed_llm_reviews' => 100,
                'llm_source' => 'managed',
                'architectural_default' => 'auto',
                'bugs_default' => true,
                'features' => [
                    'orgManagement' => true,
                    'customRules' => false,
                    'trendRetentionDays' => 90,
                ],
            ],
            PlanTier::Business => [
                'managed_llm_reviews' => 200,
                'llm_source' => 'managed',
                'architectural_default' => 'auto',
                'bugs_default' => true,
                'features' => [
                    'orgManagement' => true,
                    'customRules' => true,
                    'trendRetentionDays' => null,
                ],
            ],
            PlanTier::BusinessPlus => [
                'managed_llm_reviews' => 500,
                'llm_source' => 'managed',
                'architectural_default' => 'auto',
                'bugs_default' => true,
                'features' => [
                    'orgManagement' => true,
                    'customRules' => true,
                    'trendRetentionDays' => null,
                ],
            ],
            PlanTier::Enterprise => [
                'managed_llm_reviews' => null,
                'llm_source' => 'managed',
                'architectural_default' => 'auto',
                'bugs_default' => true,
                'features' => [
                    'orgManagement' => true,
                    'customRules' => true,
                    'trendRetentionDays' => null,
                ],
            ],
        };
    }
}
