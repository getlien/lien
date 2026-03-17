<?php

use Illuminate\Database\Migrations\Migration;
use Illuminate\Database\Schema\Blueprint;
use Illuminate\Support\Facades\Schema;

return new class extends Migration
{
    public function up(): void
    {
        Schema::table('review_runs', function (Blueprint $table) {
            $table->bigInteger('github_check_run_id')->nullable()->after('summary_comment_id');
        });
    }

    public function down(): void
    {
        Schema::table('review_runs', function (Blueprint $table) {
            $table->dropColumn('github_check_run_id');
        });
    }
};
