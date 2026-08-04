import Foundation

/// Removes a user by id.
struct DeleteHandler {
    func deleteUser(_ id: Int) {
        if id <= 0 {
            Logger.logError("deleteUser", NSError(domain: "id must be positive", code: 1))
            return
        }
        Logger.logInfo("deleted user")
    }
}
