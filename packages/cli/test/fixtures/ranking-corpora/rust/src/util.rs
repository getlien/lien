//! Shared logging helpers -- the hub module every handler in this fixture
//! crate imports.

/// Writes an informational message, prefixed for easy identification in
/// fixture output.
pub fn log_info(message: &str) {
    println!("[info] {}", message);
}

/// Writes an error message, wrapping `err` with `context`.
pub fn log_error(context: &str, err: &str) {
    println!("[error] {}: {}", context, err);
}
