<?php

use Illuminate\Database\Migrations\Migration;
use Illuminate\Database\Schema\Blueprint;
use Illuminate\Support\Facades\Schema;

return new class extends Migration
{
    public function up(): void
    {
        Schema::table('complexity_snapshots', function (Blueprint $table) {
            $table->integer('line_end')->nullable()->change();
            $table->integer('cognitive')->nullable()->change();
        });
    }

    public function down(): void
    {
        Schema::table('complexity_snapshots', function (Blueprint $table) {
            $table->integer('line_end')->nullable(false)->change();
            $table->integer('cognitive')->nullable(false)->change();
        });
    }
};
