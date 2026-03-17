<?php

use Illuminate\Database\Migrations\Migration;
use Illuminate\Database\Schema\Blueprint;
use Illuminate\Support\Facades\Schema;

return new class extends Migration
{
    public function up(): void
    {
        Schema::table('review_runs', function (Blueprint $table) {
            $table->integer('pr_number')->nullable()->change();
            $table->string('base_sha', 40)->nullable()->change();
        });
    }

    public function down(): void
    {
        Schema::table('review_runs', function (Blueprint $table) {
            $table->integer('pr_number')->nullable(false)->change();
            $table->string('base_sha', 40)->nullable(false)->change();
        });
    }
};
