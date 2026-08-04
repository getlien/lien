import Foundation

/// Shared logging helper -- the hub type every handler in this fixture
/// corpus references. Deliberately no per-file import anywhere in this
/// corpus for cross-file access within the module: Swift's whole-module
/// `import Foundation`-style imports carry no per-file specifier at all
/// (#884), so `dependentCount` genuinely stays 0 for every file here -- see
/// the ranking-regression harness's documented Swift tripwire.
enum Logger {
    static func logInfo(_ message: String) {
        print("[info] \(message)")
    }

    static func logError(_ context: String, _ err: Error) {
        print("[error] \(context): \(err)")
    }
}
