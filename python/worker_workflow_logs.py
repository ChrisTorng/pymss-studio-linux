from __future__ import annotations

import threading
from contextlib import contextmanager
from typing import Any, Iterator

from worker_infer import JsonLogHandler


class WorkflowLogScope:
    """Bind synchronous logger records to native node execution boundaries."""

    def __init__(self) -> None:
        self.local = threading.local()
        self.logger: Any = None

    def current_node_id(self) -> str | None:
        return getattr(self.local, "node_id", None)

    def track(self, event: dict[str, Any]) -> None:
        node_id = event.get("node_id")
        fraction = event.get("node_fraction")
        if node_id is None or not isinstance(fraction, (float, int)):
            return
        if fraction < 1:
            self.local.node_id = str(node_id)
        elif event.get("audio_index") is None and event.get("unit") is None and self.current_node_id() == str(node_id):
            self.local.node_id = None


@contextmanager
def workflow_logging(task_id: str) -> Iterator[WorkflowLogScope]:
    scope = WorkflowLogScope()
    try:
        from pymss import get_separation_logger
    except ImportError:
        yield scope
        return
    logger = get_separation_logger()
    scope.logger = logger
    console = getattr(logger, "console_handler", None)
    handler = JsonLogHandler(
        task_id,
        node_id_provider=scope.current_node_id,
        level_provider=(lambda: console.level) if console is not None else None,
    )
    # These records are forwarded through the JSON protocol. Keep file handlers
    # intact and prevent a second, asynchronously attributed stderr copy.
    def suppress_console(_record: Any) -> bool:
        return False

    logger.addHandler(handler)
    if console is not None:
        console.addFilter(suppress_console)
    try:
        yield scope
    finally:
        scope.local.node_id = None
        logger.removeHandler(handler)
        if console is not None:
            console.removeFilter(suppress_console)
