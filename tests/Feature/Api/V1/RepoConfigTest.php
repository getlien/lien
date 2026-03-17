<?php

namespace Tests\Feature\Api\V1;

use App\Models\Organization;
use App\Models\Repository;
use Illuminate\Foundation\Testing\RefreshDatabase;
use Tests\TestCase;
use Tests\Traits\WithServiceToken;

class RepoConfigTest extends TestCase
{
    use RefreshDatabase;
    use WithServiceToken;

    protected function setUp(): void
    {
        parent::setUp();
        $this->setUpServiceToken();
    }

    public function test_get_repo_config(): void
    {
        $org = Organization::factory()->team()->create();
        $repo = Repository::factory()->create(['organization_id' => $org->id]);

        $response = $this->getJson(
            "/api/v1/repos/{$repo->id}/config",
            $this->serviceTokenHeaders($repo->id),
        );

        $response->assertOk();
        $response->assertJsonStructure([
            'plan',
            'reviewTypes' => [
                'complexity' => ['enabled', 'threshold', 'deltaTracking'],
                'architectural' => ['enabled'],
            ],
            'complexityReviewsRemaining',
            'managedLlmReviewsRemaining',
            'llmSource',
            'features' => ['orgManagement', 'customRules', 'trendRetentionDays'],
        ]);
        $response->assertJson(['plan' => 'team', 'managedLlmReviewsRemaining' => 100]);
    }

    public function test_get_repo_config_with_overrides(): void
    {
        $org = Organization::factory()->create();
        $repo = Repository::factory()->create([
            'organization_id' => $org->id,
            'review_config' => [
                'complexity' => ['enabled' => true, 'threshold' => 10],
                'architectural' => ['enabled' => 'always'],
            ],
        ]);

        $response = $this->getJson(
            "/api/v1/repos/{$repo->id}/config",
            $this->serviceTokenHeaders($repo->id),
        );

        $response->assertOk();
        $response->assertJson([
            'reviewTypes' => [
                'complexity' => ['threshold' => 10],
                'architectural' => ['enabled' => 'always'],
            ],
        ]);
    }

    public function test_unauthenticated_request_returns_401(): void
    {
        $repo = Repository::factory()->create();

        $response = $this->getJson("/api/v1/repos/{$repo->id}/config");

        $response->assertUnauthorized();
    }

    public function test_invalid_token_returns_401(): void
    {
        $repo = Repository::factory()->create();

        $response = $this->getJson("/api/v1/repos/{$repo->id}/config", [
            'Authorization' => 'Bearer wrong-token',
        ]);

        $response->assertUnauthorized();
    }

    public function test_token_scoped_to_wrong_repo_returns_403(): void
    {
        $repo = Repository::factory()->create();
        $otherRepo = Repository::factory()->create();

        $response = $this->getJson(
            "/api/v1/repos/{$repo->id}/config",
            $this->serviceTokenHeaders($otherRepo->id),
        );

        $response->assertForbidden();
    }
}
