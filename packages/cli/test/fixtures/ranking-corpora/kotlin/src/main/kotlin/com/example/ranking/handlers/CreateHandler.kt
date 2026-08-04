package com.example.ranking.handlers

import com.example.ranking.util.Logger

/** Validates and records a new user by name. */
class CreateHandler {
    fun createUser(name: String) {
        if (name.isEmpty()) {
            Logger.logError("createUser", IllegalArgumentException("name must not be empty"))
            return
        }
        Logger.logInfo("created user $name")
    }
}
