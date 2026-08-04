import Foundation

/// Validates and records a new user by name.
struct CreateHandler {
    func createUser(_ name: String) {
        if name.isEmpty {
            Logger.logError("createUser", NSError(domain: "name must not be empty", code: 1))
            return
        }
        Logger.logInfo("created user \(name)")
    }
}
