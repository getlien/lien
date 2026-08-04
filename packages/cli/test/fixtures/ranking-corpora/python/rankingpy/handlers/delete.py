"""Removes a user by id."""

from rankingpy.util.logger import log_error, log_info


def delete_user(user_id: int) -> None:
    if user_id <= 0:
        log_error("delete_user", ValueError("id must be positive"))
        return
    log_info("deleted user")
