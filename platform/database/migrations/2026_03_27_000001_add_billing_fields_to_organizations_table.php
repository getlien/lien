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
        Schema::table('organizations', function (Blueprint $table) {
            $table->unsignedInteger('credit_balance')->default(0)->after('plan_tier');
            $table->string('billing_mode')->default('credits')->after('credit_balance');
            $table->string('stripe_customer_id')->nullable()->unique()->after('billing_mode');
            $table->string('stripe_subscription_id')->nullable()->after('stripe_customer_id');
            $table->text('byok_api_key')->nullable()->after('stripe_subscription_id');
            $table->string('byok_provider')->nullable()->after('byok_api_key');
        });
    }

    /**
     * Reverse the migrations.
     */
    public function down(): void
    {
        Schema::table('organizations', function (Blueprint $table) {
            $table->dropUnique(['stripe_customer_id']);
            $table->dropColumn([
                'credit_balance',
                'billing_mode',
                'stripe_customer_id',
                'stripe_subscription_id',
                'byok_api_key',
                'byok_provider',
            ]);
        });
    }
};
