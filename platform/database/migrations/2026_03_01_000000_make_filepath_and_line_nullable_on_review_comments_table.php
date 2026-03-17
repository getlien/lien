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
            $table->string('filepath')->nullable()->change();
            $table->integer('line')->nullable()->change();
        });
    }

    /**
     * Reverse the migrations.
     */
    public function down(): void
    {
        Schema::table('review_comments', function (Blueprint $table) {
            $table->string('filepath')->nullable(false)->change();
            $table->integer('line')->nullable(false)->change();
        });
    }
};
