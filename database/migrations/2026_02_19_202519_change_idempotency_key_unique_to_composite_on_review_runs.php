<?php

use Illuminate\Database\Migrations\Migration;
use Illuminate\Database\Schema\Blueprint;
use Illuminate\Support\Facades\Schema;

return new class extends Migration
{
    public function up(): void
    {
        Schema::table('review_runs', function (Blueprint $table) {
            $table->dropUnique(['idempotency_key']);
            $table->unique(['repository_id', 'idempotency_key']);
        });
    }

    public function down(): void
    {
        Schema::table('review_runs', function (Blueprint $table) {
            $table->dropUnique(['repository_id', 'idempotency_key']);
            $table->unique(['idempotency_key']);
        });
    }
};
