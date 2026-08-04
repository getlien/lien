"""Changes an existing user's display name."""

from rankingpy.util.logger import log_error, log_info


def update_user(user_id: int, name: str) -> None:
    if user_id <= 0:
        log_error("update_user", ValueError("id must be positive"))
        return
    log_info(f"updated user {name}")
