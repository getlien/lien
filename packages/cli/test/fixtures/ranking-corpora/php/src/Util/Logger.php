<?php

namespace RankingPhp\Util;

/**
 * Shared logging helper -- the hub class every handler in this fixture
 * corpus imports.
 */
class Logger
{
    public static function logInfo(string $message): void
    {
        echo "[info] {$message}\n";
    }

    public static function logError(string $context, \Throwable $err): void
    {
        echo "[error] {$context}: {$err->getMessage()}\n";
    }
}
