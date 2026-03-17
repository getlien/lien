<?php

use Illuminate\Database\Migrations\Migration;
use Illuminate\Database\Schema\Blueprint;
use Illuminate\Support\Facades\Schema;

return new class extends Migration
{
    public function up(): void
    {
        Schema::create('review_run_logs', function (Blueprint $table) {
            $table->id();
            $table->foreignId('review_run_id')->constrained()->cascadeOnDelete();
            $table->string('level', 10)->default('info');
            $table->text('message');
            $table->json('metadata')->nullable();
            $table->timestamp('logged_at');
            $table->timestamp('created_at')->useCurrent();

            $table->index(['review_run_id', 'id']);
        });
    }

    public function down(): void
    {
        Schema::dropIfExists('review_run_logs');
    }
};
