package com.example.ranking.util;

/**
 * Shared logging helper -- the hub class every handler in this fixture
 * corpus imports.
 */
public class Logger {
    public static void logInfo(String message) {
        System.out.println("[info] " + message);
    }

    public static void logError(String context, Exception err) {
        System.out.println("[error] " + context + ": " + err.getMessage());
    }
}
