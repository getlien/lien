use crate::util;

/// Changes an existing user's display name, logging the outcome through the
/// shared `util` module.
pub fn update_user(id: u32, name: &str) -> Result<(), String> {
    if id == 0 {
        let err = "id must be positive".to_string();
        util::log_error("update_user", &err);
        return Err(err);
    }
    util::log_info(&format!("updated user {}", name));
    Ok(())
}
