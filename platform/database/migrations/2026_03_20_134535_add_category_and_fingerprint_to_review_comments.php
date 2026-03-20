<?php

use Illuminate\Database\Migrations\Migration;
use Illuminate\Database\Schema\Blueprint;
use Illuminate\Support\Facades\Schema;

return new class extends Migration
{
    public function up(): void
    {
        Schema::table('review_comments', function (Blueprint $table) {
            $table->string('category')->nullable()->after('body');
            $table->string('fingerprint', 64)->nullable()->after('resolution');
            $table->index('fingerprint');
        });
    }

    public function down(): void
    {
        Schema::table('review_comments', function (Blueprint $table) {
            $table->dropIndex(['fingerprint']);
            $table->dropColumn(['category', 'fingerprint']);
        });
    }
};
