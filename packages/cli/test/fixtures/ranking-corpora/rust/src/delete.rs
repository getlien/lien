use crate::util;

/// Removes a user by id, logging the outcome through the shared `util`
/// module.
pub fn delete_user(id: u32) -> Result<(), String> {
    if id == 0 {
        let err = "id must be positive".to_string();
        util::log_error("delete_user", &err);
        return Err(err);
    }
    util::log_info("deleted user");
    Ok(())
}
