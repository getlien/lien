<?php

use Illuminate\Database\Migrations\Migration;
use Illuminate\Support\Facades\DB;

return new class extends Migration
{
    /**
     * Backfill review_comments that were stored as 'skipped' because the runner
     * did not send a status field. All comments from completed PR review runs
     * were actually posted to GitHub.
     */
    public function up(): void
    {
        DB::table('review_comments')
            ->where('status', 'skipped')
            ->whereIn('review_run_id', function ($query) {
                $query->select('id')
                    ->from('review_runs')
                    ->where('status', 'completed')
                    ->where('type', 'pr');
            })
            ->update(['status' => 'posted']);
    }

    public function down(): void
    {
        // Not reversible — we cannot distinguish originally-skipped from backfilled.
    }
};
