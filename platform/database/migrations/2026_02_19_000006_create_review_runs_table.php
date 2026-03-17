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
        Schema::create('review_runs', function (Blueprint $table) {
            $table->id();
            $table->foreignId('repository_id')->constrained()->cascadeOnDelete();
            $table->integer('pr_number');
            $table->string('head_sha', 40);
            $table->string('base_sha', 40);
            $table->string('idempotency_key', 64)->unique();
            $table->timestamp('started_at')->nullable();
            $table->timestamp('completed_at')->nullable();
            $table->string('status')->default('pending');
            $table->integer('files_analyzed')->default(0);
            $table->decimal('avg_complexity', 8, 2)->nullable();
            $table->decimal('max_complexity', 8, 2)->nullable();
            $table->integer('token_usage')->default(0);
            $table->decimal('cost', 10, 6)->default(0);
            $table->bigInteger('summary_comment_id')->nullable();
            $table->timestamps();

            $table->index(['repository_id', 'status']);
            $table->index(['repository_id', 'pr_number']);
        });
    }

    /**
     * Reverse the migrations.
     */
    public function down(): void
    {
        Schema::dropIfExists('review_runs');
    }
};
