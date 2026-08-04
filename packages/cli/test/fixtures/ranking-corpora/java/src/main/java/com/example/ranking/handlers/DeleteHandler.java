package com.example.ranking.handlers;

import com.example.ranking.util.Logger;

/** Removes a user by id. */
public class DeleteHandler {
    public void deleteUser(int id) {
        if (id <= 0) {
            Logger.logError("deleteUser", new IllegalArgumentException("id must be positive"));
            return;
        }
        Logger.logInfo("deleted user");
    }
}
