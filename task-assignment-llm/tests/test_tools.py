from __future__ import annotations

import json
import os
import shutil
import tempfile
import unittest
from pathlib import Path
from unittest.mock import patch

from tools import assign_task, get_alert, list_cleaner_candidates


PROJECT_ROOT = Path(__file__).resolve().parents[1]
SOURCE_DATABASE = PROJECT_ROOT / "database" / "assignment_simulation.json"


class AssignmentToolsTest(unittest.TestCase):
    def setUp(self) -> None:
        self.temporary_directory = tempfile.TemporaryDirectory()
        self.database_path = Path(self.temporary_directory.name) / "assignment_simulation.json"
        shutil.copy2(SOURCE_DATABASE, self.database_path)
        self.environment = patch.dict(
            os.environ,
            {"ASSIGNMENT_SIM_DATABASE_PATH": str(self.database_path)},
        )
        self.environment.start()

    def tearDown(self) -> None:
        self.environment.stop()
        self.temporary_directory.cleanup()

    def test_get_alert_returns_zone_and_unassigned_task(self) -> None:
        result = get_alert("ALT-001")

        self.assertTrue(result["ok"])
        self.assertEqual(result["alert"]["zoneName"], "Food Court")
        self.assertEqual(result["alert"]["taskId"], "TASK-001")
        self.assertEqual(result["alert"]["taskStatus"], "UNASSIGNED")

    def test_candidates_derive_schedule_availability_and_workload(self) -> None:
        result = list_cleaner_candidates("ALT-001")

        self.assertTrue(result["ok"])
        candidates = {item["cleanerId"]: item for item in result["candidates"]}
        self.assertEqual(set(candidates), {"CLN-001", "CLN-002", "CLN-003"})
        self.assertEqual(result["excludedCleanerCount"], 1)
        self.assertEqual(candidates["CLN-001"]["availability"], "BUSY")
        self.assertEqual(candidates["CLN-001"]["workload"], 0)
        self.assertEqual(candidates["CLN-001"]["notStartedWorkload"], 0)
        self.assertEqual(candidates["CLN-002"]["availability"], "AVAILABLE")
        self.assertEqual(candidates["CLN-002"]["workload"], 1)
        self.assertEqual(candidates["CLN-002"]["notStartedWorkload"], 1)
        self.assertEqual(candidates["CLN-003"]["availability"], "AVAILABLE")
        self.assertEqual(candidates["CLN-003"]["workload"], 0)

    def test_assign_task_persists_an_eligible_cleaner(self) -> None:
        result = assign_task("ALT-001", "CLN-002")

        self.assertTrue(result["ok"])
        self.assertFalse(result["alreadyAssigned"])
        with self.database_path.open(encoding="utf-8") as stream:
            data = json.load(stream)
        task = next(item for item in data["tasks"] if item["id"] == "TASK-001")
        self.assertEqual(task["cleanerId"], "CLN-002")
        self.assertEqual(task["status"], "ASSIGNED")
        self.assertEqual(task["assignedAt"], "2026-08-15T10:00:00+08:00")

    def test_repeating_the_same_assignment_is_idempotent(self) -> None:
        first = assign_task("ALT-001", "CLN-002")
        second = assign_task("ALT-001", "CLN-002")

        self.assertTrue(first["ok"])
        self.assertTrue(second["ok"])
        self.assertTrue(second["alreadyAssigned"])

    def test_assign_task_rejects_an_off_shift_cleaner(self) -> None:
        result = assign_task("ALT-001", "CLN-004")

        self.assertFalse(result["ok"])
        self.assertEqual(result["error"]["code"], "CLEANER_NOT_ELIGIBLE")

    def test_assigning_a_different_cleaner_after_success_is_rejected(self) -> None:
        first = assign_task("ALT-001", "CLN-002")
        second = assign_task("ALT-001", "CLN-003")

        self.assertTrue(first["ok"])
        self.assertFalse(second["ok"])
        self.assertEqual(second["error"]["code"], "TASK_ALREADY_ASSIGNED")


if __name__ == "__main__":
    unittest.main()
