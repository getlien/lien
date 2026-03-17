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
        Schema::create('review_comments', function (Blueprint $table) {
            $table->id();
            $table->foreignId('review_run_id')->constrained()->cascadeOnDelete();
            $table->string('review_type');
            $table->string('filepath');
            $table->integer('line');
            $table->string('symbol_name')->nullable();
            $table->text('body');
            $table->string('status');
            $table->bigInteger('github_comment_id')->nullable();
            $table->string('resolution')->nullable()->index();
            $table->timestamps();
        });
    }

    /**
     * Reverse the migrations.
     */
    public function down(): void
    {
        Schema::dropIfExists('review_comments');
    }
};
