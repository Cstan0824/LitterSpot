"""SQLite persistence and camera-level bin-placement ranking for the MVP."""
from __future__ import annotations

import json
import sqlite3
import uuid
from contextlib import contextmanager
from datetime import UTC, datetime, timedelta
from pathlib import Path
from typing import Any, Iterator

from PIL import Image

from .placement_analysis import DEFAULT_PLACEMENT_POLICY, PlacementDecision, PlacementPolicy, calculate_placement_ranks, parse_timestamp


class AnalysisStore:
    def __init__(self, policy: PlacementPolicy = DEFAULT_PLACEMENT_POLICY, path: Path | None = None, seed_demo: bool = False) -> None:
        root = Path(__file__).resolve().parents[2]
        self.project_root = root
        self.path = path or root / "data" / "litterspot_mvp.sqlite3"
        self.evidence_root = self.path.parent / "evidence"
        self.policy = policy
        self.seed_demo = seed_demo

    @contextmanager
    def connect(self) -> Iterator[sqlite3.Connection]:
        connection = sqlite3.connect(self.path, timeout=10)
        connection.row_factory = sqlite3.Row
        try:
            yield connection
            connection.commit()
        except Exception:
            connection.rollback()
            raise
        finally:
            connection.close()

    def initialize(self) -> None:
        self.path.parent.mkdir(parents=True, exist_ok=True)
        self.evidence_root.mkdir(parents=True, exist_ok=True)
        with self.connect() as connection:
            connection.execute("""CREATE TABLE IF NOT EXISTS analysis_runs (
                id INTEGER PRIMARY KEY AUTOINCREMENT,
                created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
                camera_id TEXT,
                image_name TEXT,
                severity TEXT NOT NULL,
                flag_count INTEGER NOT NULL,
                people_count INTEGER NOT NULL,
                payload_json TEXT NOT NULL,
                evidence_path TEXT
            )""")
            columns = {row["name"] for row in connection.execute("PRAGMA table_info(analysis_runs)").fetchall()}
            if "evidence_path" not in columns:
                connection.execute("ALTER TABLE analysis_runs ADD COLUMN evidence_path TEXT")
            connection.execute("""CREATE TABLE IF NOT EXISTS placement_state (
                camera_id TEXT PRIMARY KEY,
                window_days INTEGER NOT NULL DEFAULT 3,
                recommended INTEGER NOT NULL DEFAULT 0,
                trigger_reason TEXT,
                raise_streak INTEGER NOT NULL DEFAULT 0,
                clear_streak INTEGER NOT NULL DEFAULT 0,
                last_evaluated_at TEXT,
                updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
            )""")
            connection.execute("""CREATE TABLE IF NOT EXISTS cameras (
                id TEXT PRIMARY KEY,
                name TEXT NOT NULL,
                zone TEXT NOT NULL,
                enabled INTEGER NOT NULL DEFAULT 1,
                focus_region_json TEXT,
                created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
            )""")
            connection.execute("""CREATE TABLE IF NOT EXISTS alerts (
                id INTEGER PRIMARY KEY AUTOINCREMENT,
                analysis_run_id INTEGER NOT NULL,
                camera_id TEXT NOT NULL,
                kind TEXT NOT NULL,
                severity TEXT NOT NULL,
                confidence REAL,
                status TEXT NOT NULL DEFAULT 'active',
                created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
                updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
                resolved_at TEXT,
                FOREIGN KEY(analysis_run_id) REFERENCES analysis_runs(id),
                FOREIGN KEY(camera_id) REFERENCES cameras(id)
            )""")
            connection.execute("""CREATE TABLE IF NOT EXISTS alert_status_events (
                id INTEGER PRIMARY KEY AUTOINCREMENT,
                alert_id INTEGER NOT NULL,
                previous_status TEXT,
                new_status TEXT NOT NULL,
                operator_name TEXT NOT NULL,
                note TEXT,
                created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
                FOREIGN KEY(alert_id) REFERENCES alerts(id)
            )""")
            self._seed_cameras(connection)
            if self.seed_demo:
                self._seed_demo_cameras(connection)

    def save(
        self,
        result: dict[str, Any],
        evidence_bytes: bytes | None = None,
        evidence_name: str | None = None,
        *,
        resolve_missing_alerts: bool = False,
    ) -> int:
        flags = result["flags"]
        severity = "critical" if any(flag["severity"] == "critical" for flag in flags) else "warning" if flags else "clear"
        evidence_path = self._save_evidence(evidence_bytes, evidence_name) if evidence_bytes else None
        with self.connect() as connection:
            camera_id = result.get("cameraId")
            if camera_id:
                self._ensure_camera(connection, camera_id)
            cursor = connection.execute(
                "INSERT INTO analysis_runs (camera_id, image_name, severity, flag_count, people_count, payload_json, evidence_path) VALUES (?, ?, ?, ?, ?, ?, ?)",
                (camera_id, result.get("imageName"), severity, len(flags), result["peopleCount"], json.dumps(result), evidence_path),
            )
            run_id = int(cursor.lastrowid)
            # Sample evidence can be useful for verifying overlays, but must not
            # raise operational alerts for an imaginary camera event.
            if camera_id and not result.get("isDemo", False):
                self._create_or_refresh_alerts(connection, run_id, result)
                if resolve_missing_alerts:
                    self._resolve_missing_alerts(connection, camera_id, result)
            return run_id

    def recent(self, limit: int = 12) -> list[dict[str, Any]]:
        with self.connect() as connection:
            rows = connection.execute("SELECT id, created_at, payload_json, evidence_path FROM analysis_runs ORDER BY id DESC LIMIT ?", (limit,)).fetchall()
        return [self._analysis_row(row) for row in rows]

    def set_window_days(self, camera_id: str, window_days: int) -> None:
        if not 1 <= window_days <= 30:
            raise ValueError("window_days must be between 1 and 30")
        with self.connect() as connection:
            connection.execute("""INSERT INTO placement_state (camera_id, window_days)
                VALUES (?, ?) ON CONFLICT(camera_id) DO UPDATE SET
                window_days=excluded.window_days, recommended=0, trigger_reason=NULL,
                raise_streak=0, clear_streak=0, last_evaluated_at=NULL, updated_at=CURRENT_TIMESTAMP""", (camera_id, window_days))

    def evaluate_placement(self, camera_id: str, force: bool = False) -> dict[str, Any]:
        now = datetime.now(UTC)
        with self.connect() as connection:
            state = connection.execute("SELECT * FROM placement_state WHERE camera_id=?", (camera_id,)).fetchone()
            if state is None:
                connection.execute("INSERT INTO placement_state (camera_id) VALUES (?)", (camera_id,))
                state = connection.execute("SELECT * FROM placement_state WHERE camera_id=?", (camera_id,)).fetchone()
            window_days = int(state["window_days"])
            rows = connection.execute(
                "SELECT created_at, people_count, payload_json FROM analysis_runs WHERE camera_id=? AND created_at >= datetime('now', ?) ORDER BY created_at",
                (camera_id, f"-{window_days} days"),
            ).fetchall()
            ranks = self.policy.rank([(row["created_at"], row["people_count"], row["payload_json"]) for row in rows], window_days)

            last_evaluated = parse_timestamp(state["last_evaluated_at"]) if state["last_evaluated_at"] else None
            evaluation_due = force or last_evaluated is None or now - last_evaluated >= timedelta(hours=1)
            decision = PlacementDecision(
                bool(state["recommended"]),
                state["trigger_reason"],
                int(state["raise_streak"]),
                int(state["clear_streak"]),
            )
            if evaluation_due:
                decision = self.policy.decide(ranks, decision)
                connection.execute("""UPDATE placement_state SET recommended=?, trigger_reason=?, raise_streak=?, clear_streak=?, last_evaluated_at=?, updated_at=CURRENT_TIMESTAMP WHERE camera_id=?""",
                    (int(decision.recommended), decision.trigger_reason, decision.raise_streak, decision.clear_streak, now.isoformat(), camera_id))

        return {
            "cameraId": camera_id,
            **ranks,
            "recommended": decision.recommended,
            "triggerReason": decision.trigger_reason,
            "raiseStreak": decision.raise_streak,
            "clearStreak": decision.clear_streak,
            "nextEvaluationAt": (now + timedelta(hours=1)).isoformat(),
            "status": "insufficient_observation" if not ranks["coverageReady"] else "recommended" if decision.recommended else "not_recommended",
        }

    @staticmethod
    def _camera_defaults(camera_id: str) -> tuple[str, str]:
        defaults = {
            "camera-1": ("CAM-01", "Fantasy Land"),
            "camera-2": ("CAM-02", "Adventure World"),
            "camera-3": ("CAM-03", "Wild Safari"),
            "camera-4": ("CAM-04", "Ocean Park"),
            "camera-5": ("CAM-05", "Fantasy Land"),
            "camera-6": ("CAM-06", "Adventure World"),
        }
        return defaults.get(camera_id, (camera_id.upper(), "Unassigned zone"))

    def _seed_cameras(self, connection: sqlite3.Connection) -> None:
        for camera_id in [f"camera-{index}" for index in range(1, 7)]:
            self._ensure_camera(connection, camera_id)

    def _ensure_camera(self, connection: sqlite3.Connection, camera_id: str) -> None:
        name, zone = self._camera_defaults(camera_id)
        connection.execute(
            "INSERT OR IGNORE INTO cameras (id, name, zone) VALUES (?, ?, ?)",
            (camera_id, name, zone),
        )

    def _seed_demo_cameras(self, connection: sqlite3.Connection) -> None:
        assets = [
            self.project_root / "samples/cctv-demo/bin-normal-check.jpg",
            self.project_root / "samples/cctv-demo/contact-sheet.jpg",
            self.project_root / "samples/cctv-demo/_alternates/qa-spill-event-timeline.jpg",
            self.project_root / "samples/cctv-demo/_alternates/qa-spill-cleanup-timeline.jpg",
        ]
        assets = [asset for asset in assets if asset.is_file()]
        if not assets:
            return
        for index, camera_id in enumerate(f"camera-{item}" for item in range(1, 7)):
            existing = connection.execute(
                "SELECT 1 FROM analysis_runs WHERE camera_id=? AND evidence_path IS NOT NULL LIMIT 1", (camera_id,)
            ).fetchone()
            if existing:
                continue
            source = assets[index % len(assets)]
            with Image.open(source) as image:
                width, height = image.size
            evidence_path = self._save_evidence(source.read_bytes(), source.name)
            result = {
                "imageName": source.name,
                "cameraId": camera_id,
                "image": {"width": width, "height": height},
                "focusRegion": [],
                "peopleCount": 0,
                "people": [],
                "bins": [],
                "floorHazards": [],
                "flags": [],
                "processingTimeMs": 0,
                "isDemo": True,
            }
            connection.execute(
                "INSERT INTO analysis_runs (camera_id, image_name, severity, flag_count, people_count, payload_json, evidence_path) VALUES (?, ?, 'clear', 0, 0, ?, ?)",
                (camera_id, source.name, json.dumps(result), evidence_path),
            )

    def pending_demo_frames(self) -> list[tuple[str, str, Path]]:
        """Return the newest demo snapshot for cameras not yet analysed for display."""
        with self.connect() as connection:
            rows = connection.execute("""SELECT id, camera_id, image_name, payload_json
                FROM analysis_runs WHERE evidence_path IS NOT NULL
                ORDER BY camera_id, id DESC""").fetchall()

        pending: list[tuple[str, str, Path]] = []
        seen_cameras: set[str] = set()
        for row in rows:
            camera_id = row["camera_id"]
            if not camera_id or camera_id in seen_cameras:
                continue
            seen_cameras.add(camera_id)
            payload = json.loads(row["payload_json"])
            if not payload.get("isDemo", False) or payload.get("processingTimeMs", 0) > 0:
                continue
            evidence = self.evidence_path(int(row["id"]))
            if evidence is not None:
                pending.append((camera_id, row["image_name"] or evidence.name, evidence))
        return pending

    def _save_evidence(self, content: bytes, image_name: str | None) -> str:
        suffix = Path(image_name or "frame.jpg").suffix.lower()
        suffix = suffix if suffix in {".jpg", ".jpeg", ".png", ".webp"} else ".jpg"
        relative = Path("evidence") / f"{uuid.uuid4().hex}{suffix}"
        target = self.path.parent / relative
        target.write_bytes(content)
        return str(relative).replace("\\", "/")

    @staticmethod
    def _flag_confidence(result: dict[str, Any], kind: str) -> float | None:
        for hazard in result.get("floorHazards", []):
            if hazard.get("className") == kind:
                return float(hazard.get("confidence", 0))
        if kind == "bin_overflow":
            candidates = [float(item.get("stateConfidence", 0)) for item in result.get("bins", []) if item.get("state") == "overflow"]
            return max(candidates, default=None)
        return None

    def _create_or_refresh_alerts(self, connection: sqlite3.Connection, run_id: int, result: dict[str, Any]) -> None:
        camera_id = result["cameraId"]
        for flag in result.get("flags", []):
            active = connection.execute(
                "SELECT id FROM alerts WHERE camera_id=? AND kind=? AND status='active' ORDER BY id DESC LIMIT 1",
                (camera_id, flag["kind"]),
            ).fetchone()
            confidence = self._flag_confidence(result, flag["kind"])
            if active:
                connection.execute(
                    "UPDATE alerts SET analysis_run_id=?, severity=?, confidence=?, updated_at=CURRENT_TIMESTAMP WHERE id=?",
                    (run_id, flag["severity"], confidence, active["id"]),
                )
            else:
                cursor = connection.execute(
                    "INSERT INTO alerts (analysis_run_id, camera_id, kind, severity, confidence) VALUES (?, ?, ?, ?, ?)",
                    (run_id, camera_id, flag["kind"], flag["severity"], confidence),
                )
                connection.execute(
                    "INSERT INTO alert_status_events (alert_id, new_status, operator_name, note) VALUES (?, 'active', 'system', 'Created from confirmed pipeline flag')",
                    (cursor.lastrowid,),
                )

    @staticmethod
    def _resolve_missing_alerts(connection: sqlite3.Connection, camera_id: str, result: dict[str, Any]) -> None:
        active_kinds = {flag["kind"] for flag in result.get("flags", [])}
        resolvable_kinds = {"bin_overflow", "floor_litter", "floor_spill", "people_present"}
        missing = resolvable_kinds - active_kinds
        if not missing:
            return
        placeholders = ",".join("?" for _ in missing)
        rows = connection.execute(
            f"SELECT id FROM alerts WHERE camera_id=? AND status='active' AND kind IN ({placeholders})",
            [camera_id, *sorted(missing)],
        ).fetchall()
        for row in rows:
            connection.execute(
                "UPDATE alerts SET status='resolved', updated_at=CURRENT_TIMESTAMP, resolved_at=CURRENT_TIMESTAMP WHERE id=?",
                (row["id"],),
            )
            connection.execute(
                "INSERT INTO alert_status_events (alert_id, previous_status, new_status, operator_name, note) VALUES (?, 'active', 'resolved', 'system', 'Resolved by confirmed video change')",
                (row["id"],),
            )

    @staticmethod
    def _analysis_row(row: sqlite3.Row) -> dict[str, Any]:
        payload = json.loads(row["payload_json"])
        return {
            **payload,
            "id": row["id"],
            "analysisId": row["id"],
            "createdAt": row["created_at"],
            "evidenceAvailable": bool(row["evidence_path"]),
        }

    def evidence_path(self, analysis_id: int) -> Path | None:
        with self.connect() as connection:
            row = connection.execute("SELECT evidence_path FROM analysis_runs WHERE id=?", (analysis_id,)).fetchone()
        if row is None or not row["evidence_path"]:
            return None
        candidate = (self.path.parent / row["evidence_path"]).resolve()
        return candidate if candidate.is_file() and self.evidence_root.resolve() in candidate.parents else None

    def alerts(
        self,
        status: str | None = None,
        severity: str | None = None,
        kind: str | None = None,
        query: str | None = None,
    ) -> list[dict[str, Any]]:
        clauses: list[str] = []
        values: list[Any] = []
        if status:
            clauses.append("a.status=?")
            values.append(status)
        if severity:
            clauses.append("a.severity=?")
            values.append(severity)
        if kind:
            clauses.append("a.kind=?")
            values.append(kind)
        if query:
            clauses.append("(a.kind LIKE ? OR a.camera_id LIKE ? OR c.name LIKE ? OR c.zone LIKE ?)")
            values.extend([f"%{query}%"] * 4)
        where = f"WHERE {' AND '.join(clauses)}" if clauses else ""
        with self.connect() as connection:
            rows = connection.execute(f"""SELECT a.*, c.name AS camera_name, c.zone, r.payload_json, r.evidence_path
                FROM alerts a JOIN cameras c ON c.id=a.camera_id JOIN analysis_runs r ON r.id=a.analysis_run_id
                {where}
                ORDER BY CASE a.status WHEN 'active' THEN 0 WHEN 'resolved' THEN 1 ELSE 2 END,
                         CASE a.severity WHEN 'critical' THEN 0 ELSE 1 END, a.updated_at DESC""", values).fetchall()
        return [self._alert_row(row) for row in rows]

    @staticmethod
    def _alert_row(row: sqlite3.Row) -> dict[str, Any]:
        payload = json.loads(row["payload_json"])
        return {
            "id": row["id"],
            "analysisId": row["analysis_run_id"],
            "cameraId": row["camera_id"],
            "cameraName": row["camera_name"],
            "zone": row["zone"],
            "kind": row["kind"],
            "severity": row["severity"],
            "confidence": row["confidence"],
            "status": row["status"],
            "createdAt": row["created_at"],
            "updatedAt": row["updated_at"],
            "resolvedAt": row["resolved_at"],
            "imageName": payload.get("imageName"),
            "peopleCount": payload.get("peopleCount", 0),
            "evidenceAvailable": bool(row["evidence_path"]),
        }

    def update_alert_status(self, alert_id: int, status: str, operator_name: str, note: str | None) -> dict[str, Any] | None:
        with self.connect() as connection:
            row = connection.execute("SELECT status FROM alerts WHERE id=?", (alert_id,)).fetchone()
            if row is None:
                return None
            previous = row["status"]
            connection.execute(
                "UPDATE alerts SET status=?, updated_at=CURRENT_TIMESTAMP, resolved_at=CASE WHEN ?='resolved' THEN CURRENT_TIMESTAMP ELSE NULL END WHERE id=?",
                (status, status, alert_id),
            )
            connection.execute(
                "INSERT INTO alert_status_events (alert_id, previous_status, new_status, operator_name, note) VALUES (?, ?, ?, ?, ?)",
                (alert_id, previous, status, operator_name, note),
            )
        return next((item for item in self.alerts() if item["id"] == alert_id), None)

    def dashboard(self) -> dict[str, Any]:
        with self.connect() as connection:
            cameras = connection.execute("""SELECT c.id AS camera_id, c.name, c.zone, c.enabled, r.id, r.created_at, r.payload_json, r.evidence_path
                FROM cameras c LEFT JOIN analysis_runs r ON r.id=(SELECT id FROM analysis_runs WHERE camera_id=c.id ORDER BY id DESC LIMIT 1)
                ORDER BY c.id""").fetchall()
            counts = connection.execute("SELECT status, COUNT(*) AS count FROM alerts GROUP BY status").fetchall()
        statuses = {row["status"]: row["count"] for row in counts}
        items = []
        for camera in cameras:
            payload = json.loads(camera["payload_json"]) if camera["payload_json"] else None
            items.append({
                "id": camera["camera_id"], "name": camera["name"], "zone": camera["zone"], "enabled": bool(camera["enabled"]),
                "latest": self._analysis_row(camera) if payload else None,
            })
        return {"cameras": items, "summary": {"activeAlerts": statuses.get("active", 0), "resolvedAlerts": statuses.get("resolved", 0), "configuredCameras": sum(item["enabled"] for item in items)}}

    def placement_summary(self) -> dict[str, Any]:
        with self.connect() as connection:
            cameras = connection.execute("SELECT id, name, zone FROM cameras ORDER BY id").fetchall()
        recommendations = []
        for camera in cameras:
            rank = self.evaluate_placement(camera["id"])
            recommendations.append({"cameraId": camera["id"], "cameraName": camera["name"], "zone": camera["zone"], **rank})
        return {"items": recommendations}
