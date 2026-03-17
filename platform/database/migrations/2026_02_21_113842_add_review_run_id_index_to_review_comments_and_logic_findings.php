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
        Schema::table('review_comments', function (Blueprint $table) {
            $table->index('review_run_id');
        });

        Schema::table('logic_findings', function (Blueprint $table) {
            $table->index('review_run_id');
        });
    }

    /**
     * Reverse the migrations.
     */
    public function down(): void
    {
        Schema::table('review_comments', function (Blueprint $table) {
            $table->dropIndex(['review_run_id']);
        });

        Schema::table('logic_findings', function (Blueprint $table) {
            $table->dropIndex(['review_run_id']);
        });
    }
};
