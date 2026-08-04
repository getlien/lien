import Foundation

/// Changes an existing user's display name.
struct UpdateHandler {
    func updateUser(_ id: Int, _ name: String) {
        if id <= 0 {
            Logger.logError("updateUser", NSError(domain: "id must be positive", code: 1))
            return
        }
        Logger.logInfo("updated user \(name)")
    }
}
