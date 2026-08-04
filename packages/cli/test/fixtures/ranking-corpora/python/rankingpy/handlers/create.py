"""Validates and records a new user by name."""

from rankingpy.util.logger import log_error, log_info


def create_user(name: str) -> None:
    if not name:
        log_error("create_user", ValueError("name must not be empty"))
        return
    log_info(f"created user {name}")
