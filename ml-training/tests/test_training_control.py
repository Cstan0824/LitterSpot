import tempfile
import unittest
from pathlib import Path
import sys

sys.path.insert(0, str(Path(__file__).resolve().parents[1] / "scripts"))
from training_control import Resources, TrainingControl, f2

CONFIG = {
    "run": {"name": "test", "max_hours": 12},
    "selection": {},
    "resources": {
        "sample_seconds": 10, "minimum_disk_free_gb": 10,
        "system_ram_percent": 92, "system_ram_sustained_seconds": 60,
        "system_cpu_percent": 98, "system_cpu_sustained_seconds": 300,
        "gpu_temperature_c": 85, "gpu_temperature_sustained_seconds": 30,
        "gpu_memory_percent": 95, "gpu_memory_sustained_seconds": 60,
        "stalled_progress_minutes": 20,
    },
}

class ControlTests(unittest.TestCase):
    def test_f2_emphasizes_recall(self):
        self.assertGreater(f2(0.8, 0.9), f2(0.9, 0.8))

    def test_disk_limit_stops_immediately(self):
        with tempfile.TemporaryDirectory() as directory:
            control = TrainingControl(Path(directory), CONFIG)
            snapshot = Resources("now", 20, None, 30, 1, 9, 80, 1000, 6000, 60, 30)
            self.assertIn("disk free", control.unsafe(snapshot))

    def test_high_gpu_utilization_is_not_a_stop_condition(self):
        with tempfile.TemporaryDirectory() as directory:
            control = TrainingControl(Path(directory), CONFIG)
            snapshot = Resources("now", 20, None, 30, 1, 100, 100, 3000, 6000, 70, 60)
            self.assertIsNone(control.unsafe(snapshot))

if __name__ == "__main__": unittest.main()
