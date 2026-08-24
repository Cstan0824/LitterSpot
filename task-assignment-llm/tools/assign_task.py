"""Validate and persist one cleaner assignment."""

from __future__ import annotations

from typing import Any

from ._candidate_logic import build_candidates, find_by_id, simulation_time, task_for_alert
from ._database import AssignmentDatabaseError, database_lock, load_database, write_database_atomic


def assign_task(alert_id: str, cleaner_id: str) -> dict[str, Any]:
    """Assign an eligible cleaner to an unassigned simulated task.

    Args:
        alert_id: Exact simulated alert identifier, such as ``ALT-001``.
        cleaner_id: Exact cleaner identifier returned by
            ``list_cleaner_candidates``.

    Returns:
        A JSON-serializable assignment result. Repeating the same successful
        assignment is idempotent; assigning a different cleaner is rejected.
    """

    with database_lock():
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

        if task.get("status") == "ASSIGNED" and task.get("cleanerId") == cleaner_id:
            return {
                "ok": True,
                "alreadyAssigned": True,
                "assignment": {
                    "alertId": alert_id,
                    "taskId": task.get("id"),
                    "cleanerId": cleaner_id,
                    "taskStatus": "ASSIGNED",
                    "assignedAt": task.get("assignedAt"),
                },
            }
        if task.get("status") != "UNASSIGNED" or task.get("cleanerId") is not None:
            return {
                "ok": False,
                "error": {
                    "code": "TASK_ALREADY_ASSIGNED",
                    "message": f"Task {task.get('id')} is already assigned.",
                },
            }

        candidates, _ = build_candidates(data, alert_id)
        eligible_ids = {candidate["cleanerId"] for candidate in candidates}
        if cleaner_id not in eligible_ids:
            return {
                "ok": False,
                "error": {
                    "code": "CLEANER_NOT_ELIGIBLE",
                    "message": f"Cleaner {cleaner_id} is not an eligible candidate for {alert_id}.",
                },
            }

        task["cleanerId"] = cleaner_id
        task["status"] = "ASSIGNED"
        task["assignedAt"] = at.isoformat()
        try:
            write_database_atomic(data)
        except AssignmentDatabaseError as error:
            return {"ok": False, "error": {"code": "DATABASE_ERROR", "message": str(error)}}

        return {
            "ok": True,
            "alreadyAssigned": False,
            "assignment": {
                "alertId": alert_id,
                "taskId": task.get("id"),
                "cleanerId": cleaner_id,
                "taskStatus": task.get("status"),
                "assignedAt": task.get("assignedAt"),
            },
        }
