import Foundation

/// Fixture corpus entry point, wiring the handlers to the shared logger.
Logger.logInfo("starting ranking-swift fixture service")
CreateHandler().createUser("ada")
