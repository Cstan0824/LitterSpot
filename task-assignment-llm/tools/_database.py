"""Safe access to the isolated JSON assignment simulation."""

from __future__ import annotations

import json
import os
import tempfile
import threading
from pathlib import Path
from typing import Any


PROJECT_ROOT = Path(__file__).resolve().parents[1]
DEFAULT_DATABASE_PATH = PROJECT_ROOT / "database" / "assignment_simulation.json"
DATABASE_PATH_ENV = "ASSIGNMENT_SIM_DATABASE_PATH"
_DATABASE_LOCK = threading.Lock()


class AssignmentDatabaseError(RuntimeError):
    """Raised when the isolated assignment database cannot be used safely."""


def get_database_path() -> Path:
    """Resolve the configured JSON database and reject unsafe targets."""

    configured = os.getenv(DATABASE_PATH_ENV)
    path = Path(configured).expanduser() if configured else DEFAULT_DATABASE_PATH
    path = path.resolve()

    if path.suffix.lower() != ".json":
        raise AssignmentDatabaseError("The assignment simulation database must be a JSON file.")
    if path.name == "litterspot_mvp.sqlite3":
        raise AssignmentDatabaseError("The main LitterSpot database cannot be used by assignment tools.")
    return path


def load_database() -> dict[str, Any]:
    """Read and minimally validate the complete JSON simulation."""

    path = get_database_path()
    try:
        with path.open("r", encoding="utf-8") as stream:
            data = json.load(stream)
    except FileNotFoundError as error:
        raise AssignmentDatabaseError(f"Assignment database not found: {path}") from error
    except json.JSONDecodeError as error:
        raise AssignmentDatabaseError(f"Assignment database contains invalid JSON: {error}") from error
    except OSError as error:
        raise AssignmentDatabaseError(f"Assignment database could not be read: {error}") from error

    required_objects = ("metadata",)
    required_lists = ("zones", "zoneDistances", "cleaners", "alerts", "tasks")
    if not isinstance(data, dict):
        raise AssignmentDatabaseError("Assignment database root must be a JSON object.")
    if any(not isinstance(data.get(key), dict) for key in required_objects):
        raise AssignmentDatabaseError("Assignment database metadata is missing or invalid.")
    if any(not isinstance(data.get(key), list) for key in required_lists):
        raise AssignmentDatabaseError("Assignment database collections are missing or invalid.")
    return data


def write_database_atomic(data: dict[str, Any]) -> None:
    """Replace the configured JSON database without exposing a partial write."""

    path = get_database_path()
    path.parent.mkdir(parents=True, exist_ok=True)
    temporary_path: Path | None = None
    try:
        descriptor, temporary_name = tempfile.mkstemp(
            dir=path.parent,
            prefix=f".{path.stem}-",
            suffix=".tmp",
        )
        temporary_path = Path(temporary_name)
        with os.fdopen(descriptor, "w", encoding="utf-8") as stream:
            json.dump(data, stream, indent=2, ensure_ascii=False)
            stream.write("\n")
            stream.flush()
            os.fsync(stream.fileno())
        os.replace(temporary_path, path)
        temporary_path = None
    except OSError as error:
        raise AssignmentDatabaseError(f"Assignment database could not be written: {error}") from error
    finally:
        if temporary_path is not None:
            temporary_path.unlink(missing_ok=True)


def database_lock() -> threading.Lock:
    """Return the process-local lock used for read-modify-write operations."""

    return _DATABASE_LOCK
