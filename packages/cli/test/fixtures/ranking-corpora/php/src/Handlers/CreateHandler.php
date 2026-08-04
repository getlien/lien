<?php

namespace RankingPhp\Handlers;

use RankingPhp\Util\Logger;

/** Validates and records a new user by name. */
class CreateHandler
{
    public function createUser(string $name): void
    {
        if ($name === '') {
            Logger::logError('createUser', new \InvalidArgumentException('name must not be empty'));
            return;
        }
        Logger::logInfo("created user {$name}");
    }
}
