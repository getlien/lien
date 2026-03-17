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
        Schema::dropIfExists('logic_findings');
    }

    /**
     * Reverse the migrations.
     */
    public function down(): void
    {
        Schema::create('logic_findings', function (Blueprint $table) {
            $table->id();
            $table->foreignId('review_run_id')->constrained()->cascadeOnDelete();
            $table->string('filepath');
            $table->string('symbol_name')->nullable();
            $table->unsignedInteger('line');
            $table->string('category');
            $table->string('severity');
            $table->text('message');
            $table->text('evidence')->nullable();
            $table->boolean('suppressed')->default(false);
            $table->text('suppression_reason')->nullable();
            $table->timestamps();

            $table->index('review_run_id');
        });
    }
};
