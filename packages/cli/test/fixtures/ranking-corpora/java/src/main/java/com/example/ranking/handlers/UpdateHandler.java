package com.example.ranking.handlers;

import com.example.ranking.util.Logger;

/** Changes an existing user's display name. */
public class UpdateHandler {
    public void updateUser(int id, String name) {
        if (id <= 0) {
            Logger.logError("updateUser", new IllegalArgumentException("id must be positive"));
            return;
        }
        Logger.logInfo("updated user " + name);
    }
}
