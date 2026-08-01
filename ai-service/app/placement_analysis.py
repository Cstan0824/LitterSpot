"""Pure, configurable policy for camera-level bin-placement recommendations."""
from __future__ import annotations

import json
from dataclasses import dataclass
from datetime import UTC, datetime, timedelta
from typing import Any


def parse_timestamp(value: str) -> datetime:
    parsed = datetime.fromisoformat(value.replace("Z", "+00:00"))
    return parsed.replace(tzinfo=UTC) if parsed.tzinfo is None else parsed.astimezone(UTC)


@dataclass(frozen=True)
class PlacementDecision:
    recommended: bool
    trigger_reason: str | None
    raise_streak: int
    clear_streak: int


@dataclass(frozen=True)
class PlacementPolicy:
    """Owns ranking thresholds and hysteresis; persistence remains replaceable."""

    default_window_days: int = 3
    overflow_threshold: float = 67.0
    popularity_threshold: float = 80.0
    min_hours_per_day: int = 8
    sample_interval_seconds: int = 60
    episode_quiet_minutes: int = 30
    evaluations_to_raise: int = 2
    evaluations_to_clear: int = 6
    clear_margin: float = 10.0

    def rank(self, rows: list[tuple[str, int, str]], window_days: int | None = None) -> dict[str, Any]:
        window_days = window_days or self.default_window_days
        minute_samples: dict[datetime, tuple[int, dict[str, Any]]] = {}
        for created_at, people_count, payload_json in rows:
            timestamp = parse_timestamp(created_at).replace(second=0, microsecond=0)
            minute_samples[timestamp] = (people_count, json.loads(payload_json))

        samples_by_day: dict[str, list[tuple[datetime, int, dict[str, Any]]]] = {}
        for timestamp, (people_count, payload) in sorted(minute_samples.items()):
            samples_by_day.setdefault(timestamp.date().isoformat(), []).append((timestamp, people_count, payload))
        required_daily_samples = self.min_hours_per_day * 60
        valid_samples = [sample for day in samples_by_day.values() if len(day) >= required_daily_samples for sample in day]
        valid_days = sum(len(day) >= required_daily_samples for day in samples_by_day.values())

        people_counts = [sample[1] for sample in valid_samples]
        average_people = sum(people_counts) / len(people_counts) if people_counts else 0.0
        presence_ratio = sum(count > 0 for count in people_counts) / len(people_counts) if people_counts else 0.0
        popularity_rank = min(100.0, 100.0 * min(average_people / 2.0, presence_ratio / 0.25))

        overflow_timestamps = [
            timestamp for timestamp, _, payload in valid_samples
            if any(flag.get("kind") == "bin_overflow" for flag in payload.get("flags", []))
        ]
        episodes: list[datetime] = []
        last_overflow: datetime | None = None
        for timestamp in overflow_timestamps:
            if last_overflow is None or timestamp - last_overflow >= timedelta(minutes=self.episode_quiet_minutes):
                episodes.append(timestamp)
            last_overflow = timestamp
        overflow_rate = len(episodes) / valid_days if valid_days else 0.0

        return {
            "windowDays": window_days,
            "sampleIntervalSeconds": self.sample_interval_seconds,
            "validDays": valid_days,
            "requiredValidDays": window_days,
            "observedSamples": len(minute_samples),
            "validSamples": len(valid_samples),
            "coverageReady": valid_days >= window_days,
            "overflowEpisodes": len(episodes),
            "overflowEpisodesPerDay": round(overflow_rate, 3),
            "overflowRank": round(min(100.0, overflow_rate * 100.0), 1),
            "overflowThreshold": self.overflow_threshold,
            "averagePeoplePerFrame": round(average_people, 3),
            "peoplePresentFrameRatio": round(presence_ratio, 4),
            "popularityRank": round(popularity_rank, 1),
            "popularityThreshold": self.popularity_threshold,
        }

    def decide(self, ranks: dict[str, Any], current: PlacementDecision) -> PlacementDecision:
        overflow_pass = ranks["overflowRank"] >= self.overflow_threshold
        popularity_pass = ranks["popularityRank"] >= self.popularity_threshold
        passing = ranks["coverageReady"] and (overflow_pass or popularity_pass)
        recommended = current.recommended
        trigger_reason = current.trigger_reason
        raise_streak = current.raise_streak
        clear_streak = current.clear_streak

        if recommended:
            below_clear = (
                ranks["coverageReady"]
                and ranks["overflowRank"] < self.overflow_threshold - self.clear_margin
                and ranks["popularityRank"] < self.popularity_threshold - self.clear_margin
            )
            clear_streak = clear_streak + 1 if below_clear else 0
            if clear_streak >= self.evaluations_to_clear:
                recommended, trigger_reason, clear_streak = False, None, 0
        else:
            raise_streak = raise_streak + 1 if passing else 0
            if raise_streak >= self.evaluations_to_raise:
                recommended = True
                trigger_reason = "both" if overflow_pass and popularity_pass else "frequent_overflow" if overflow_pass else "high_popularity"
                raise_streak = 0

        return PlacementDecision(recommended, trigger_reason, raise_streak, clear_streak)


DEFAULT_PLACEMENT_POLICY = PlacementPolicy()


def calculate_placement_ranks(
    rows: list[tuple[str, int, str]], window_days: int = 3, min_hours_per_day: int = 8
) -> dict[str, Any]:
    """Compatibility wrapper for scripts using the original function API."""
    return PlacementPolicy(min_hours_per_day=min_hours_per_day).rank(rows, window_days)
