<?php

use Illuminate\Database\Migrations\Migration;
use Illuminate\Support\Facades\DB;

return new class extends Migration
{
    /**
     * Run the migrations.
     */
    public function up(): void
    {
        DB::table('organizations')
            ->whereNull('billing_mode')
            ->orWhere('billing_mode', '')
            ->update(['billing_mode' => 'credits']);

        $orgs = DB::table('organizations')
            ->where('credit_balance', 0)
            ->get(['id']);

        foreach ($orgs as $org) {
            $alreadyGranted = DB::table('credit_transactions')
                ->where('organization_id', $org->id)
                ->where('type', 'initial_grant')
                ->exists();

            if (! $alreadyGranted) {
                DB::table('organizations')
                    ->where('id', $org->id)
                    ->update(['credit_balance' => 5]);

                DB::table('credit_transactions')->insert([
                    'organization_id' => $org->id,
                    'type' => 'initial_grant',
                    'amount' => 5,
                    'balance_after' => 5,
                    'description' => 'Welcome credits',
                    'created_at' => now(),
                ]);
            }
        }
    }

    /**
     * Reverse the migrations.
     */
    public function down(): void
    {
        DB::table('credit_transactions')
            ->where('type', 'initial_grant')
            ->where('description', 'Welcome credits')
            ->delete();

        DB::table('organizations')->update(['credit_balance' => 0]);
    }
};
