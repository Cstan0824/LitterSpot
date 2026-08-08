"""Session-scoped semantic change tracking for uploaded video frames."""
from __future__ import annotations

from collections import deque
from dataclasses import dataclass, field
from math import floor
from time import monotonic

from .analysis_store import AnalysisStore
from .schemas import BoundingBox, LocalizedBinAnalysis, PipelineAnalysisResponse, PipelineFlag, VideoChange, VideoFrameAnalysisResponse


@dataclass
class _Snapshot:
    bins: dict[str, str]
    hazards: frozenset[str]
    people_count: int


@dataclass
class _Track:
    bbox: BoundingBox
    detection: LocalizedBinAnalysis
    consecutive_seen: int = 1
    missed: int = 0
    confirmed: bool = False


@dataclass
class _Session:
    camera_id: str
    next_bin_id: int = 1
    tracks: dict[str, _Track] = field(default_factory=dict)
    baseline: _Snapshot | None = None
    pending: _Snapshot | None = None
    pending_count: int = 0
    occurrences: dict[str, deque[int]] = field(default_factory=dict)
    active_flag_keys: set[str] = field(default_factory=set)
    last_seen: float = field(default_factory=monotonic)


class VideoSessionTracker:
    """Assign stable bin IDs and persist only two-sample semantic changes."""

    def __init__(self, store: AnalysisStore, session_ttl_seconds: int = 3600) -> None:
        self.store = store
        self.session_ttl_seconds = session_ttl_seconds
        self.sessions: dict[str, _Session] = {}

    def observe(
        self,
        session_id: str,
        camera_id: str,
        timestamp_seconds: float,
        result: PipelineAnalysisResponse,
        evidence_bytes: bytes,
        evidence_name: str,
    ) -> VideoFrameAnalysisResponse:
        self._prune()
        session = self.sessions.get(session_id)
        if session is None:
            session = _Session(camera_id=camera_id)
            self.sessions[session_id] = session
        elif session.camera_id != camera_id:
            raise ValueError("A video session cannot change camera ID")
        session.last_seen = monotonic()

        self._assign_bin_ids(session, result)
        newly_flagged, flag_progress = self._apply_flag_policy(session, result, timestamp_seconds)
        snapshot = self._snapshot(result)
        result.sourceType = "video"
        result.videoSessionId = session_id
        result.videoTimestampSeconds = timestamp_seconds

        if session.baseline is None:
            if snapshot == session.pending:
                session.pending_count += 1
            else:
                session.pending = snapshot
                session.pending_count = 1
            if session.pending_count < 2:
                return VideoFrameAnalysisResponse(
                    result=result, confirmationProgress=1,
                    flagConfirmationProgress=flag_progress,
                    videoTimestampSeconds=timestamp_seconds,
                )
            session.baseline = snapshot
            session.pending = None
            session.pending_count = 0
            result.analysisId = self.store.save(
                result.model_dump(), evidence_bytes, evidence_name,
            )
            return VideoFrameAnalysisResponse(
                result=result, persisted=True, baseline=True,
                confirmationProgress=2, flagConfirmationProgress=flag_progress,
                videoTimestampSeconds=timestamp_seconds,
            )

        if snapshot == session.baseline:
            session.pending = None
            session.pending_count = 0
            if newly_flagged:
                result.analysisId = self.store.save(result.model_dump(), evidence_bytes, evidence_name)
                return VideoFrameAnalysisResponse(
                    result=result, persisted=True, confirmationProgress=2,
                    flagConfirmationProgress=flag_progress, videoTimestampSeconds=timestamp_seconds,
                )
            return VideoFrameAnalysisResponse(
                result=result, flagConfirmationProgress=flag_progress,
                videoTimestampSeconds=timestamp_seconds,
            )

        if snapshot == session.pending:
            session.pending_count += 1
        else:
            session.pending = snapshot
            session.pending_count = 1

        if session.pending_count < 2:
            return VideoFrameAnalysisResponse(
                result=result, confirmationProgress=1,
                flagConfirmationProgress=flag_progress, videoTimestampSeconds=timestamp_seconds,
            )

        changes = self._changes(session.baseline, snapshot, timestamp_seconds)
        session.baseline = snapshot
        session.pending = None
        session.pending_count = 0
        result.analysisId = self.store.save(
            result.model_dump(), evidence_bytes, evidence_name, resolve_missing_alerts=True,
        )
        return VideoFrameAnalysisResponse(
            result=result, changes=changes, persisted=True,
            confirmationProgress=2, flagConfirmationProgress=flag_progress,
            videoTimestampSeconds=timestamp_seconds,
        )

    def _assign_bin_ids(self, session: _Session, result: PipelineAnalysisResponse) -> None:
        available = set(session.tracks)
        seen: set[str] = set()
        for detected in list(result.bins):
            match = self._best_track(detected.bbox, available, session.tracks, result.image.width, result.image.height)
            if match is None:
                match = f"bin-{session.next_bin_id}"
                session.next_bin_id += 1
                track = _Track(bbox=detected.bbox, detection=detected.model_copy(deep=True))
                session.tracks[match] = track
            else:
                available.remove(match)
                track = session.tracks[match]
                track.consecutive_seen = track.consecutive_seen + 1 if track.missed == 0 else 1
                track.missed = 0
                track.bbox = detected.bbox
            track.confirmed = track.confirmed or track.consecutive_seen >= 2
            detected.trackingId = match
            detected.stale = False
            # Video confirmation is based on two matched localization + state samples.
            # The still-image classifier's camera tracker is intentionally not trusted
            # as the session baseline gate because it can retain state across replays.
            detected.confirmed = track.confirmed
            track.detection = detected.model_copy(deep=True)
            seen.add(match)

        for tracking_id in list(session.tracks):
            if tracking_id in seen:
                continue
            track = session.tracks[tracking_id]
            track.missed += 1
            if track.confirmed and track.missed == 1:
                carried = track.detection.model_copy(deep=True)
                carried.stale = True
                carried.confirmed = True
                result.bins.append(carried)
            elif track.missed > 2:
                del session.tracks[tracking_id]

    @staticmethod
    def _apply_flag_policy(
        session: _Session,
        result: PipelineAnalysisResponse,
        timestamp_seconds: float,
    ) -> tuple[bool, int]:
        """Flag the same detection only after four distinct samples in ten seconds."""
        candidates: dict[str, PipelineFlag] = {}
        for item in result.bins:
            if item.state == "overflow" and not item.stale:
                entity = item.trackingId or f"bin-{item.binIndex}"
                candidates[f"bin_overflow:{entity}"] = PipelineFlag(
                    severity="critical", kind="bin_overflow",
                    message=f"{entity}: overflow detected 4 times within 10 seconds",
                )
        for hazard in result.floorHazards:
            candidates[f"hazard:{hazard.className}"] = PipelineFlag(
                severity="critical" if hazard.className == "floor_spill" else "warning",
                kind=hazard.className,
                message=f"{hazard.className.replace('_', ' ').title()} detected 4 times within 10 seconds",
            )
        if result.peopleCount > 0:
            candidates["people_present"] = PipelineFlag(
                severity="warning", kind="people_present",
                message="People detected 4 times within 10 seconds",
            )

        sample_second = floor(timestamp_seconds)
        cutoff = sample_second - 10
        progress = 0
        for key in candidates:
            occurrences = session.occurrences.setdefault(key, deque())
            while occurrences and occurrences[0] < cutoff:
                occurrences.popleft()
            if not occurrences or occurrences[-1] != sample_second:
                occurrences.append(sample_second)
            progress = max(progress, min(len(occurrences), 4))

        qualified = {key for key in candidates if len(session.occurrences[key]) >= 4}
        newly_flagged = bool(qualified - session.active_flag_keys)
        session.active_flag_keys = qualified
        result.flags = [candidates[key] for key in sorted(qualified)]
        return newly_flagged, progress

    @classmethod
    def _best_track(
        cls,
        bbox: BoundingBox,
        available: set[str],
        tracks: dict[str, _Track],
        width: int,
        height: int,
    ) -> str | None:
        ranked = sorted(
            ((cls._match_score(bbox, tracks[item].bbox, width, height), item) for item in available),
            reverse=True,
        )
        return ranked[0][1] if ranked and ranked[0][0] >= 0.35 else None

    @classmethod
    def _match_score(cls, first: BoundingBox, second: BoundingBox, width: int, height: int) -> float:
        overlap = cls._iou(first, second)
        first_center = ((first.x1 + first.x2) / 2, (first.y1 + first.y2) / 2)
        second_center = ((second.x1 + second.x2) / 2, (second.y1 + second.y2) / 2)
        dx = (first_center[0] - second_center[0]) / max(width, 1)
        dy = (first_center[1] - second_center[1]) / max(height, 1)
        proximity = max(0.0, 1.0 - ((dx * dx + dy * dy) ** 0.5) / 0.25)
        return max(overlap, proximity * 0.7)

    @staticmethod
    def _iou(first: BoundingBox, second: BoundingBox) -> float:
        width = max(0.0, min(first.x2, second.x2) - max(first.x1, second.x1))
        height = max(0.0, min(first.y2, second.y2) - max(first.y1, second.y1))
        intersection = width * height
        first_area = max(0.0, first.x2 - first.x1) * max(0.0, first.y2 - first.y1)
        second_area = max(0.0, second.x2 - second.x1) * max(0.0, second.y2 - second.y1)
        union = first_area + second_area - intersection
        return intersection / union if union else 0.0

    @staticmethod
    def _snapshot(result: PipelineAnalysisResponse) -> _Snapshot:
        return _Snapshot(
            bins={item.trackingId or f"bin-{item.binIndex}": item.state for item in result.bins},
            hazards=frozenset(item.className for item in result.floorHazards),
            people_count=result.peopleCount,
        )

    @staticmethod
    def _changes(previous: _Snapshot, current: _Snapshot, timestamp: float) -> list[VideoChange]:
        changes: list[VideoChange] = []
        for entity_id in sorted(previous.bins.keys() | current.bins.keys()):
            before, after = previous.bins.get(entity_id), current.bins.get(entity_id)
            if before == after:
                continue
            kind = "bin_appeared" if before is None else "bin_disappeared" if after is None else "bin_state"
            changes.append(VideoChange(kind=kind, entityId=entity_id, previous=before, current=after, videoTimestampSeconds=timestamp))
        for hazard in sorted(previous.hazards | current.hazards):
            was_present, is_present = hazard in previous.hazards, hazard in current.hazards
            if was_present == is_present:
                continue
            changes.append(VideoChange(
                kind="floor_hazard_appeared" if is_present else "floor_hazard_disappeared",
                entityId=hazard,
                previous="present" if was_present else None,
                current="present" if is_present else None,
                videoTimestampSeconds=timestamp,
            ))
        if previous.people_count != current.people_count:
            changes.append(VideoChange(
                kind="people_count", entityId="people", previous=str(previous.people_count),
                current=str(current.people_count), videoTimestampSeconds=timestamp,
            ))
        return changes

    def _prune(self) -> None:
        cutoff = monotonic() - self.session_ttl_seconds
        self.sessions = {key: session for key, session in self.sessions.items() if session.last_seen >= cutoff}
