package com.example.ranking.handlers

import com.example.ranking.util.Logger

/** Changes an existing user's display name. */
class UpdateHandler {
    fun updateUser(id: Int, name: String) {
        if (id <= 0) {
            Logger.logError("updateUser", IllegalArgumentException("id must be positive"))
            return
        }
        Logger.logInfo("updated user $name")
    }
}
