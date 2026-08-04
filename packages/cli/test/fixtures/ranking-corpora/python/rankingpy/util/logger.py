"""Shared logging helpers -- the hub module every handler in this fixture
corpus imports."""


def log_info(message: str) -> None:
    """Write an informational message, prefixed for easy identification."""
    print(f"[info] {message}")


def log_error(context: str, err: Exception) -> None:
    """Write an error message, wrapping err with context."""
    print(f"[error] {context}: {err}")
