"""Read one simulated alert and its task."""

from __future__ import annotations

from typing import Any

from ._candidate_logic import find_by_id, task_for_alert
from ._database import AssignmentDatabaseError, load_database


def get_alert(alert_id: str) -> dict[str, Any]:
    """Get an alert and its current task from the isolated simulation.

    Args:
        alert_id: Exact simulated alert identifier, such as ``ALT-001``.

    Returns:
        A JSON-serializable result containing alert, zone, and task state.
    """

    try:
        data = load_database()
    except AssignmentDatabaseError as error:
        return {"ok": False, "error": {"code": "DATABASE_ERROR", "message": str(error)}}

    alert = find_by_id(data["alerts"], alert_id)
    if alert is None:
        return {
            "ok": False,
            "error": {"code": "ALERT_NOT_FOUND", "message": f"Alert {alert_id} was not found."},
        }

    task = task_for_alert(data, alert_id)
    if task is None:
        return {
            "ok": False,
            "error": {"code": "TASK_NOT_FOUND", "message": f"Alert {alert_id} has no task."},
        }

    zone = find_by_id(data["zones"], alert.get("zoneId"))
    return {
        "ok": True,
        "alert": {
            "alertId": alert["id"],
            "alertStatus": alert.get("status"),
            "zoneId": alert.get("zoneId"),
            "zoneName": zone.get("name") if zone else None,
            "taskId": task.get("id"),
            "taskStatus": task.get("status"),
            "cleanerId": task.get("cleanerId"),
        },
    }
