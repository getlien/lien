"""Fixture corpus entry point, wiring the handlers to the shared logger."""

from rankingpy.handlers.create import create_user
from rankingpy.util.logger import log_info

if __name__ == "__main__":
    log_info("starting ranking-python fixture service")
    create_user("ada")
