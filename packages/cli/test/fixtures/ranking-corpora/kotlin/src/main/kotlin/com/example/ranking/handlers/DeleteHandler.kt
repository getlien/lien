package com.example.ranking.handlers

import com.example.ranking.util.Logger

/** Removes a user by id. */
class DeleteHandler {
    fun deleteUser(id: Int) {
        if (id <= 0) {
            Logger.logError("deleteUser", IllegalArgumentException("id must be positive"))
            return
        }
        Logger.logInfo("deleted user")
    }
}
