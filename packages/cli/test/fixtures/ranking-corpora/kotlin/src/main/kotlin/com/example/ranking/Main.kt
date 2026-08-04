package com.example.ranking

import com.example.ranking.handlers.CreateHandler
import com.example.ranking.util.Logger

/** Fixture corpus entry point, wiring the handlers to the shared logger. */
fun main() {
    Logger.logInfo("starting ranking-kotlin fixture service")
    CreateHandler().createUser("ada")
}
