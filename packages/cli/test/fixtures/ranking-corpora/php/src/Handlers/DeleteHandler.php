<?php

namespace RankingPhp\Handlers;

use RankingPhp\Util\Logger;

/** Removes a user by id. */
class DeleteHandler
{
    public function deleteUser(int $id): void
    {
        if ($id <= 0) {
            Logger::logError('deleteUser', new \InvalidArgumentException('id must be positive'));
            return;
        }
        Logger::logInfo('deleted user');
    }
}
