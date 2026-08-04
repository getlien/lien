package com.example.ranking.handlers;

import com.example.ranking.util.Logger;

/** Validates and records a new user by name. */
public class CreateHandler {
    public void createUser(String name) {
        if (name == null || name.isEmpty()) {
            Logger.logError("createUser", new IllegalArgumentException("name must not be empty"));
            return;
        }
        Logger.logInfo("created user " + name);
    }
}
