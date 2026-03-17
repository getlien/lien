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
        Schema::table('review_runs', function (Blueprint $table) {
            $table->string('head_ref')->nullable()->after('head_sha');
            $table->string('base_ref')->nullable()->after('base_sha');
        });
    }

    public function down(): void
    {
        Schema::table('review_runs', function (Blueprint $table) {
            $table->dropColumn(['head_ref', 'base_ref']);
        });
    }
};
