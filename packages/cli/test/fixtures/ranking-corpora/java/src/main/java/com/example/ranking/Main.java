package com.example.ranking;

import com.example.ranking.handlers.CreateHandler;
import com.example.ranking.util.Logger;

/** Fixture corpus entry point, wiring the handlers to the shared logger. */
public class Main {
    public static void main(String[] args) {
        Logger.logInfo("starting ranking-java fixture service");
        new CreateHandler().createUser("ada");
    }
}
