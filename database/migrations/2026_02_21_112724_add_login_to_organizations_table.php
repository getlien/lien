<?php

use Illuminate\Database\Migrations\Migration;
use Illuminate\Database\Schema\Blueprint;
use Illuminate\Support\Facades\DB;
use Illuminate\Support\Facades\Schema;

return new class extends Migration
{
    /**
     * Run the migrations.
     */
    public function up(): void
    {
        Schema::table('organizations', function (Blueprint $table) {
            $table->string('login')->nullable()->after('name');
        });

        DB::table('organizations')->whereNull('login')->update([
            'login' => DB::raw('slug'),
        ]);

        Schema::table('organizations', function (Blueprint $table) {
            $table->string('login')->nullable(false)->change();
        });
    }

    /**
     * Reverse the migrations.
     */
    public function down(): void
    {
        Schema::table('organizations', function (Blueprint $table) {
            $table->dropColumn('login');
        });
    }
};
