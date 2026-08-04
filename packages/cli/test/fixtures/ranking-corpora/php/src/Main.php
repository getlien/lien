<?php

namespace RankingPhp;

use RankingPhp\Handlers\CreateHandler;
use RankingPhp\Util\Logger;

/** Fixture corpus entry point, wiring the handlers to the shared logger. */
class Main
{
    public static function run(): void
    {
        Logger::logInfo('starting ranking-php fixture service');
        (new CreateHandler())->createUser('ada');
    }
}
