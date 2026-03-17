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
        Schema::create('complexity_snapshots', function (Blueprint $table) {
            $table->id();
            $table->foreignId('review_run_id')->constrained()->cascadeOnDelete();
            $table->foreignId('repository_id')->constrained()->cascadeOnDelete();
            $table->string('filepath');
            $table->string('symbol_name');
            $table->string('symbol_type');
            $table->integer('cyclomatic');
            $table->integer('cognitive');
            $table->decimal('halstead_effort', 12, 2)->nullable();
            $table->decimal('halstead_bugs', 8, 4)->nullable();
            $table->integer('line_start');
            $table->integer('line_end');
            $table->integer('delta_cyclomatic')->nullable();
            $table->integer('delta_cognitive')->nullable();
            $table->string('severity')->default('none');
            $table->timestamp('created_at')->nullable();

            $table->index(['repository_id', 'filepath', 'symbol_name']);
        });
    }

    /**
     * Reverse the migrations.
     */
    public function down(): void
    {
        Schema::dropIfExists('complexity_snapshots');
    }
};
