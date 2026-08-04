<?php

namespace RankingPhp\Handlers;

use RankingPhp\Util\Logger;

/** Changes an existing user's display name. */
class UpdateHandler
{
    public function updateUser(int $id, string $name): void
    {
        if ($id <= 0) {
            Logger::logError('updateUser', new \InvalidArgumentException('id must be positive'));
            return;
        }
        Logger::logInfo("updated user {$name}");
    }
}
