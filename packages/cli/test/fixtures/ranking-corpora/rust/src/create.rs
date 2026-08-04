use crate::util;

/// Validates and records a new user by name, logging the outcome through the
/// shared `util` module.
pub fn create_user(name: &str) -> Result<(), String> {
    if name.is_empty() {
        let err = "name must not be empty".to_string();
        util::log_error("create_user", &err);
        return Err(err);
    }
    util::log_info(&format!("created user {}", name));
    Ok(())
}
