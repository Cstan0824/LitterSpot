"""Shared schedule, workload, and candidate calculations for assignment tools."""

from __future__ import annotations

from datetime import datetime, time, timedelta
from typing import Any

from ._database import AssignmentDatabaseError


def find_by_id(items: list[dict[str, Any]], item_id: str) -> dict[str, Any] | None:
    return next((item for item in items if item.get("id") == item_id), None)


def task_for_alert(data: dict[str, Any], alert_id: str) -> dict[str, Any] | None:
    return next((task for task in data["tasks"] if task.get("alertId") == alert_id), None)


def simulation_time(data: dict[str, Any]) -> datetime:
    value = data["metadata"].get("simulationTime")
    if not isinstance(value, str):
        raise AssignmentDatabaseError("metadata.simulationTime must be an ISO-8601 string.")
    try:
        parsed = datetime.fromisoformat(value)
    except ValueError as error:
        raise AssignmentDatabaseError("metadata.simulationTime is not valid ISO-8601.") from error
    if parsed.tzinfo is None:
        raise AssignmentDatabaseError("metadata.simulationTime must include a UTC offset.")
    return parsed


def _parse_time(value: Any) -> time:
    if not isinstance(value, str):
        raise AssignmentDatabaseError("Schedule startTime and endTime must be strings.")
    try:
        return time.fromisoformat(value)
    except ValueError as error:
        raise AssignmentDatabaseError(f"Invalid schedule time: {value}") from error


def is_scheduled(cleaner: dict[str, Any], at: datetime) -> bool:
    """Return whether a cleaner has a shift covering the simulation time."""

    day = at.strftime("%A").upper()
    previous_day = (at - timedelta(days=1)).strftime("%A").upper()
    current_time = at.timetz().replace(tzinfo=None)

    for shift in cleaner.get("schedule", []):
        days = shift.get("days", [])
        if not isinstance(days, list):
            raise AssignmentDatabaseError("Schedule days must be a list.")
        start = _parse_time(shift.get("startTime"))
        end = _parse_time(shift.get("endTime"))
        if start <= end:
            if day in days and start <= current_time < end:
                return True
        elif (day in days and current_time >= start) or (
            previous_day in days and current_time < end
        ):
            return True
    return False


def workload_for(data: dict[str, Any], cleaner_id: str) -> dict[str, int]:
    assigned = sum(
        task.get("cleanerId") == cleaner_id and task.get("status") == "ASSIGNED"
        for task in data["tasks"]
    )
    in_progress = sum(
        task.get("cleanerId") == cleaner_id and task.get("status") == "IN_PROGRESS"
        for task in data["tasks"]
    )
    not_started = assigned
    return {
        "assignedTasks": assigned,
        "inProgressTasks": in_progress,
        "notStartedWorkload": not_started,
        "workload": not_started,
    }


def distance_rank(data: dict[str, Any], from_zone_id: str, to_zone_id: str) -> int | None:
    match = next(
        (
            distance
            for distance in data["zoneDistances"]
            if distance.get("fromZoneId") == from_zone_id
            and distance.get("toZoneId") == to_zone_id
        ),
        None,
    )
    rank = match.get("distanceRank") if match else None
    return rank if isinstance(rank, int) and rank >= 0 else None


def build_candidates(data: dict[str, Any], alert_id: str) -> tuple[list[dict[str, Any]], int]:
    """Build eligible candidate facts without ranking or selecting a cleaner."""

    alert = find_by_id(data["alerts"], alert_id)
    if alert is None:
        return [], 0

    zone_names = {zone.get("id"): zone.get("name") for zone in data["zones"]}
    at = simulation_time(data)
    candidates: list[dict[str, Any]] = []
    excluded = 0

    for cleaner in data["cleaners"]:
        if cleaner.get("accountStatus") != "ACTIVE" or not is_scheduled(cleaner, at):
            excluded += 1
            continue

        registered_zone_id = cleaner.get("registeredZoneId")
        rank = distance_rank(data, alert.get("zoneId"), registered_zone_id)
        if rank is None:
            excluded += 1
            continue

        workload = workload_for(data, cleaner.get("id"))
        candidates.append(
            {
                "cleanerId": cleaner.get("id"),
                "name": cleaner.get("name"),
                "registeredZoneId": registered_zone_id,
                "registeredZoneName": zone_names.get(registered_zone_id),
                "zoneDistanceRank": rank,
                "scheduledNow": True,
                "availability": "BUSY" if workload["inProgressTasks"] else "AVAILABLE",
                **workload,
            }
        )

    return candidates, excluded
