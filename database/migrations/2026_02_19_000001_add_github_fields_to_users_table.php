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
        Schema::table('users', function (Blueprint $table) {
            $table->bigInteger('github_id')->unique()->nullable()->after('id');
            $table->string('github_username')->nullable()->after('github_id');
            $table->string('avatar_url')->nullable()->after('github_username');
            $table->text('github_token')->nullable()->after('avatar_url');
            $table->string('password')->nullable()->change();
        });
    }

    /**
     * Reverse the migrations.
     */
    public function down(): void
    {
        Schema::table('users', function (Blueprint $table) {
            $table->dropColumn(['github_id', 'github_username', 'avatar_url', 'github_token']);
            $table->string('password')->nullable(false)->change();
        });
    }
};
