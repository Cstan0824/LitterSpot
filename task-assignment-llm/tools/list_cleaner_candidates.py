"""Return current cleaner facts for one unassigned alert."""

from __future__ import annotations

from typing import Any

from ._candidate_logic import build_candidates, find_by_id, simulation_time, task_for_alert
from ._database import AssignmentDatabaseError, load_database


def list_cleaner_candidates(alert_id: str) -> dict[str, Any]:
    """List active, scheduled cleaner candidates without ranking them.

    Args:
        alert_id: Exact simulated alert identifier, such as ``ALT-001``.

    Returns:
        A JSON-serializable list containing location, availability, and workload
        facts for each eligible cleaner.
    """

    try:
        data = load_database()
        at = simulation_time(data)
    except AssignmentDatabaseError as error:
        return {"ok": False, "error": {"code": "DATABASE_ERROR", "message": str(error)}}

    alert = find_by_id(data["alerts"], alert_id)
    if alert is None:
        return {
            "ok": False,
            "error": {"code": "ALERT_NOT_FOUND", "message": f"Alert {alert_id} was not found."},
        }
    if alert.get("status") != "ACTIVE":
        return {
            "ok": False,
            "error": {"code": "ALERT_NOT_ACTIVE", "message": f"Alert {alert_id} is not active."},
        }

    task = task_for_alert(data, alert_id)
    if task is None:
        return {
            "ok": False,
            "error": {"code": "TASK_NOT_FOUND", "message": f"Alert {alert_id} has no task."},
        }
    if task.get("status") != "UNASSIGNED" or task.get("cleanerId") is not None:
        return {
            "ok": False,
            "error": {
                "code": "TASK_ALREADY_ASSIGNED",
                "message": f"Task {task.get('id')} is not unassigned.",
            },
        }

    candidates, excluded = build_candidates(data, alert_id)
    return {
        "ok": True,
        "alertId": alert_id,
        "taskId": task.get("id"),
        "simulationTime": at.isoformat(),
        "candidateCount": len(candidates),
        "excludedCleanerCount": excluded,
        "candidates": candidates,
    }
