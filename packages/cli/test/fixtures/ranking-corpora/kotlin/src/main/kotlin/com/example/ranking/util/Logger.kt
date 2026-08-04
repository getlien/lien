package com.example.ranking.util

/**
 * Shared logging helper -- the hub object every handler in this fixture
 * corpus imports.
 */
object Logger {
    fun logInfo(message: String) {
        println("[info] $message")
    }

    fun logError(context: String, err: Exception) {
        println("[error] $context: ${err.message}")
    }
}
