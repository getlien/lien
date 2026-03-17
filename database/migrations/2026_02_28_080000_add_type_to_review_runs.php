<?php

use Illuminate\Database\Migrations\Migration;
use Illuminate\Database\Schema\Blueprint;
use Illuminate\Support\Facades\DB;
use Illuminate\Support\Facades\Schema;

return new class extends Migration
{
    public function up(): void
    {
        Schema::table('review_runs', function (Blueprint $table) {
            $table->string('type', 10)->default('pr')->after('repository_id');
            $table->index(['repository_id', 'type', 'status']);
        });

        DB::table('review_runs')
            ->whereNull('pr_number')
            ->update(['type' => 'baseline']);
    }

    public function down(): void
    {
        Schema::table('review_runs', function (Blueprint $table) {
            $table->dropIndex(['repository_id', 'type', 'status']);
            $table->dropColumn('type');
        });
    }
};
