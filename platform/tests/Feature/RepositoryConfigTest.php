<?php

namespace Tests\Feature;

use App\Models\Organization;
use App\Models\Repository;
use App\Models\User;
use Illuminate\Foundation\Testing\RefreshDatabase;
use Tests\TestCase;
use Tests\Traits\WithServiceToken;

class RepositoryConfigTest extends TestCase
{
    use RefreshDatabase;
    use WithServiceToken;

    protected function setUp(): void
    {
        parent::setUp();
        $this->setUpServiceToken();
    }

    public function test_show_config_page(): void
    {
        $user = User::factory()->create();
        $org = Organization::factory()->team()->create();
        $user->organizations()->attach($org->id, ['role' => 'admin']);
        $repo = Repository::factory()->create(['organization_id' => $org->id]);

        $response = $this->actingAs($user)->get("/repos/{$repo->id}/config");

        $response->assertOk();
        $response->assertInertia(fn ($page) => $page
            ->component('Repositories/Config')
            ->has('repository')
            ->has('organization')
            ->has('effectiveConfig')
        );
    }

    public function test_update_config(): void
    {
        $user = User::factory()->create();
        $org = Organization::factory()->create();
        $user->organizations()->attach($org->id, ['role' => 'admin']);
        $repo = Repository::factory()->create(['organization_id' => $org->id]);

        $response = $this->actingAs($user)->put("/repos/{$repo->id}/config", [
            'review_config' => [
                'complexity' => ['enabled' => true, 'threshold' => 10],
                'architectural' => ['enabled' => 'auto'],
            ],
        ]);

        $response->assertRedirect();

        $repo->refresh();
        $this->assertEquals(10, $repo->review_config['complexity']['threshold']);
    }

    public function test_api_update_config(): void
    {
        $repo = Repository::factory()->create();

        $response = $this->putJson("/api/v1/repos/{$repo->id}/config", [
            'review_config' => [
                'complexity' => ['threshold' => 20],
            ],
        ], $this->serviceTokenHeaders($repo->id));

        $response->assertOk();
        $response->assertJson([
            'reviewTypes' => [
                'complexity' => ['threshold' => 20],
            ],
        ]);

        $repo->refresh();
        $this->assertEquals(20, $repo->review_config['complexity']['threshold']);
    }

    public function test_update_config_with_summary_disabled(): void
    {
        $user = User::factory()->create();
        $org = Organization::factory()->create();
        $user->organizations()->attach($org->id, ['role' => 'admin']);
        $repo = Repository::factory()->create(['organization_id' => $org->id]);

        $response = $this->actingAs($user)->put("/repos/{$repo->id}/config", [
            'review_config' => [
                'complexity' => ['enabled' => true, 'threshold' => 15],
                'architectural' => ['enabled' => 'auto'],
                'summary' => ['enabled' => false],
            ],
        ]);

        $response->assertRedirect();

        $repo->refresh();
        $this->assertFalse($repo->review_config['summary']['enabled']);
    }

    public function test_reset_config_to_defaults(): void
    {
        $user = User::factory()->create();
        $org = Organization::factory()->create();
        $user->organizations()->attach($org->id, ['role' => 'admin']);
        $repo = Repository::factory()->create([
            'organization_id' => $org->id,
            'review_config' => ['complexity' => ['threshold' => 25]],
        ]);

        $response = $this->actingAs($user)->delete("/repos/{$repo->id}/config");

        $response->assertRedirect();

        $repo->refresh();
        $this->assertEmpty($repo->review_config);
    }

    public function test_non_admin_cannot_reset_config(): void
    {
        $user = User::factory()->create();
        $org = Organization::factory()->create();
        $user->organizations()->attach($org->id, ['role' => 'member']);
        $repo = Repository::factory()->create([
            'organization_id' => $org->id,
            'review_config' => ['complexity' => ['threshold' => 25]],
        ]);

        $response = $this->actingAs($user)->delete("/repos/{$repo->id}/config");

        $response->assertForbidden();
    }

    public function test_reset_preserves_effective_config_with_plan_defaults(): void
    {
        $user = User::factory()->create();
        $org = Organization::factory()->create();
        $user->organizations()->attach($org->id, ['role' => 'admin']);
        $repo = Repository::factory()->create([
            'organization_id' => $org->id,
            'review_config' => ['complexity' => ['threshold' => 25]],
        ]);

        $this->actingAs($user)->delete("/repos/{$repo->id}/config");

        $response = $this->actingAs($user)->get("/repos/{$repo->id}/config");

        $response->assertOk();
        $response->assertInertia(fn ($page) => $page
            ->component('Repositories/Config')
            ->has('effectiveConfig')
            ->where('effectiveConfig.reviewTypes.complexity.threshold', 15)
            ->where('effectiveConfig.reviewTypes.complexity.enabled', true)
            ->where('effectiveConfig.reviewTypes.summary.enabled', true)
        );
    }

    public function test_non_member_cannot_view_config(): void
    {
        $user = User::factory()->create();
        $repo = Repository::factory()->create();

        $response = $this->actingAs($user)->get("/repos/{$repo->id}/config");

        $response->assertForbidden();
    }

    public function test_non_member_cannot_update_config(): void
    {
        $user = User::factory()->create();
        $org = Organization::factory()->create();
        $user->organizations()->attach($org->id, ['role' => 'member']);
        $repo = Repository::factory()->create(['organization_id' => $org->id]);

        $response = $this->actingAs($user)->put("/repos/{$repo->id}/config", [
            'review_config' => ['complexity' => ['enabled' => true]],
        ]);

        $response->assertForbidden();
    }
}
