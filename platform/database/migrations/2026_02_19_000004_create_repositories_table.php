<?php

use Illuminate\Database\Migrations\Migration;
use Illuminate\Database\Schema\Blueprint;
use Illuminate\Support\Facades\Schema;

return new class extends Migration
{
    /**
     * Run the migrations.
     */
    public function up(): void
    {
        Schema::create('repositories', function (Blueprint $table) {
            $table->id();
            $table->foreignId('organization_id')->constrained()->cascadeOnDelete();
            $table->bigInteger('github_id')->unique();
            $table->string('full_name');
            $table->string('default_branch')->default('main');
            $table->boolean('is_private')->default(false);
            $table->jsonb('review_config')->default('{}');
            $table->boolean('is_active')->default(true);
            $table->timestamps();

            $table->index(['organization_id', 'is_active']);
        });
    }

    /**
     * Reverse the migrations.
     */
    public function down(): void
    {
        Schema::dropIfExists('repositories');
    }
};
