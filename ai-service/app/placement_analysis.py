"""Short-window, explainable bin-replacement recommendation policy."""
from __future__ import annotations

import json
from dataclasses import dataclass
from datetime import UTC, datetime, timedelta
from math import hypot
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
class BinReplacementPolicy:
    """Deep policy module for the provisional zone replacement decision.

    The public seam is :meth:`evaluate`. Rows are persisted analyses represented
    as ``(created_at, people_count, payload_json)``. The implementation hides
    minute collapsing, hazard episode deduplication, scoring, and hysteresis.
    """

    default_window_minutes: int = 10
    minimum_valid_minutes: int = 8
    unknown_ratio_limit: float = .20
    score_threshold: float = 70.0
    minimum_high_signals: int = 2
    bin_high_threshold: float = 50.0
    litter_high_threshold: float = 50.0
    spill_high_threshold: float = 50.0
    popularity_high_threshold: float = 60.0
    evaluations_to_raise: int = 2
    evaluations_to_clear: int = 3
    hazard_gap_minutes: int = 2
    hazard_match_distance: float = .12
    sample_interval_seconds: int = 60

    # Legacy settings remain available while old reports migrate.
    default_window_days: int = 3
    overflow_threshold: float = 67.0
    popularity_threshold: float = 80.0
    min_hours_per_day: int = 8
    episode_quiet_minutes: int = 30
    clear_margin: float = 10.0

    def evaluate(
        self,
        rows: list[tuple[str, int, str]],
        current: PlacementDecision | None = None,
        *,
        window_minutes: int | None = None,
    ) -> dict[str, Any]:
        """Evaluate the latest short window and advance stable recommendation state."""
        current = current or PlacementDecision(False, None, 0, 0)
        window_minutes = window_minutes or self.default_window_minutes
        if not 5 <= window_minutes <= 30:
            raise ValueError("window_minutes must be between 5 and 30")

        samples = self._minute_samples(rows, window_minutes)
        observed_minutes = len(samples)
        valid_minutes = observed_minutes
        unknown_minutes = sum(1 for sample in samples if sample["unknown"])
        full_minutes = sum(1 for sample in samples if sample["full"])
        litter_episodes = self._count_hazard_episodes(samples, "floor_litter")
        spill_episodes = self._count_hazard_episodes(samples, "floor_spill")

        bin_pressure = self._percentage(full_minutes, valid_minutes)
        litter_pressure = min(100.0, litter_episodes / 3.0 * 100.0)
        spill_pressure = min(100.0, spill_episodes / 2.0 * 100.0)
        popularity_ratio = (
            sum(1 for sample in samples if sample["people_present"]) / valid_minutes
            if valid_minutes else 0.0
        )
        human_popularity = min(100.0, popularity_ratio / .60 * 100.0)
        signals = {
            "binPressure": round(bin_pressure, 1),
            "litterPressure": round(litter_pressure, 1),
            "spillPressure": round(spill_pressure, 1),
            "humanPopularity": round(human_popularity, 1),
        }
        high_signals = [
            name for name, value, threshold in (
                ("bin_pressure", bin_pressure, self.bin_high_threshold),
                ("litter_pressure", litter_pressure, self.litter_high_threshold),
                ("spill_pressure", spill_pressure, self.spill_high_threshold),
                ("human_popularity", human_popularity, self.popularity_high_threshold),
            ) if value >= threshold
        ]
        unknown_ratio = unknown_minutes / valid_minutes if valid_minutes else 1.0
        coverage_ready = valid_minutes >= self.minimum_valid_minutes and unknown_ratio <= self.unknown_ratio_limit
        score = round(.50 * bin_pressure + .25 * litter_pressure + .10 * spill_pressure + .15 * human_popularity, 1)
        passing = coverage_ready and score >= self.score_threshold and len(high_signals) >= self.minimum_high_signals

        recommended = current.recommended
        trigger_reason = current.trigger_reason
        raise_streak = current.raise_streak
        clear_streak = current.clear_streak
        if not coverage_ready:
            # Preserve the last stable recommendation while evidence is weak.
            raise_streak = clear_streak = 0
            decision = "insufficient_evidence"
        elif recommended:
            raise_streak = 0
            if passing:
                clear_streak = 0
            else:
                clear_streak += 1
                if clear_streak >= self.evaluations_to_clear:
                    recommended, trigger_reason, clear_streak = False, None, 0
            decision = "replacement_recommended" if recommended else "keep_current_bin"
        else:
            clear_streak = 0
            if passing:
                raise_streak += 1
                if raise_streak >= self.evaluations_to_raise:
                    recommended = True
                    trigger_reason = self._trigger_reason(high_signals)
                    raise_streak = 0
            else:
                raise_streak = 0
            decision = "replacement_recommended" if recommended else "keep_current_bin"

        return {
            "decision": decision,
            "recommended": recommended,
            "provisional": True,
            "windowMinutes": window_minutes,
            "sampleIntervalSeconds": self.sample_interval_seconds,
            "observedSamples": observed_minutes,
            "validSamples": valid_minutes,
            "requiredValidSamples": self.minimum_valid_minutes,
            "coverageReady": coverage_ready,
            "unknownMinutes": unknown_minutes,
            "unknownStateRatio": round(unknown_ratio, 4),
            "fullMinutes": full_minutes,
            "litterEpisodes": litter_episodes,
            "spillEpisodes": spill_episodes,
            "score": score,
            "scoreThreshold": self.score_threshold,
            "signals": signals,
            "highSignals": high_signals,
            "triggerReason": trigger_reason,
            "raiseStreak": raise_streak,
            "clearStreak": clear_streak,
        }

    @staticmethod
    def _percentage(numerator: int, denominator: int) -> float:
        return numerator / denominator * 100.0 if denominator else 0.0

    @staticmethod
    def _trigger_reason(high_signals: list[str]) -> str:
        if "bin_pressure" in high_signals and "litter_pressure" in high_signals:
            return "full_bin_with_recurring_litter"
        if "bin_pressure" in high_signals:
            return "capacity_pressure"
        if "litter_pressure" in high_signals:
            return "recurring_litter"
        if "spill_pressure" in high_signals:
            return "recurring_spills"
        return "high_zone_activity"

    def _minute_samples(self, rows: list[tuple[str, int, str]], window_minutes: int) -> list[dict[str, Any]]:
        grouped: dict[datetime, list[tuple[int, dict[str, Any]]]] = {}
        for created_at, people_count, payload_json in rows:
            timestamp = parse_timestamp(created_at).replace(second=0, microsecond=0)
            payload = json.loads(payload_json)
            grouped.setdefault(timestamp, []).append((int(people_count), payload))
        if not grouped:
            return []
        latest = max(grouped)
        first = latest - timedelta(minutes=window_minutes - 1)
        samples: list[dict[str, Any]] = []
        for timestamp, observations in sorted(grouped.items()):
            if timestamp < first:
                continue
            states: list[str] = []
            capacity_pressure = False
            hazards: dict[str, list[tuple[float, float]]] = {"floor_litter": [], "floor_spill": []}
            for _, payload in observations:
                for bin_item in payload.get("bins", []):
                    raw_state = str(bin_item.get("state") or "unknown").lower()
                    stable_value = bin_item.get("stableState")
                    stable_state = str(stable_value).lower() if stable_value is not None else ""
                    # When the classifier explicitly reports a stable
                    # unknown, do not fall back to a tempting raw full state.
                    state = stable_state if stable_value is not None else raw_state
                    states.append(state)
                    if state == "full":
                        capacity_pressure = True
                    elif state == "overflow":
                        # A raw one-frame overflow is deliberately not allowed
                        # to drive placement. Stable/confirmed overflow is.
                        capacity_pressure = capacity_pressure or stable_state == "overflow" or bool(bin_item.get("confirmed"))
                image = payload.get("image") or {}
                width, height = float(image.get("width") or 1), float(image.get("height") or 1)
                for hazard in payload.get("floorHazards", []):
                    kind = str(hazard.get("className") or "")
                    if kind not in hazards:
                        continue
                    bbox = hazard.get("bbox") or {}
                    cx = (float(bbox.get("x1", 0)) + float(bbox.get("x2", 0))) / 2 / width
                    cy = (float(bbox.get("y1", 0)) + float(bbox.get("y2", 0))) / 2 / height
                    if not any(hypot(cx - x, cy - y) <= .04 for x, y in hazards[kind]):
                        hazards[kind].append((cx, cy))
            known_states = {state for state in states if state in {"normal", "full", "overflow"}}
            samples.append({
                "timestamp": timestamp,
                "people_present": any(people_count > 0 for people_count, _ in observations),
                "full": capacity_pressure,
                "unknown": not known_states,
                "hazards": hazards,
            })
        return samples

    def _count_hazard_episodes(self, samples: list[dict[str, Any]], kind: str) -> int:
        episodes: list[dict[str, Any]] = []
        for sample in samples:
            timestamp = sample["timestamp"]
            for point in sample["hazards"][kind]:
                matching = [episode for episode in episodes if (
                    timestamp - episode["last"] <= timedelta(minutes=self.hazard_gap_minutes)
                    and hypot(point[0] - episode["point"][0], point[1] - episode["point"][1]) <= self.hazard_match_distance
                )]
                if matching:
                    episode = min(matching, key=lambda item: hypot(point[0] - item["point"][0], point[1] - item["point"][1]))
                    episode["last"], episode["point"] = timestamp, point
                else:
                    episodes.append({"last": timestamp, "point": point})
        return len(episodes)

    # Compatibility surface for the previous multi-day ranking report.
    def rank(self, rows: list[tuple[str, int, str]], window_days: int | None = None) -> dict[str, Any]:
        window_days = window_days or self.default_window_days
        minute_samples: dict[datetime, tuple[int, dict[str, Any]]] = {}
        for created_at, people_count, payload_json in rows:
            timestamp = parse_timestamp(created_at).replace(second=0, microsecond=0)
            minute_samples[timestamp] = (people_count, json.loads(payload_json))
        samples_by_day: dict[str, list[tuple[datetime, int, dict[str, Any]]]] = {}
        for timestamp, value in sorted(minute_samples.items()):
            samples_by_day.setdefault(timestamp.date().isoformat(), []).append((timestamp, *value))
        required_daily_samples = self.min_hours_per_day * 60
        valid_samples = [sample for day in samples_by_day.values() if len(day) >= required_daily_samples for sample in day]
        valid_days = sum(len(day) >= required_daily_samples for day in samples_by_day.values())
        people_counts = [sample[1] for sample in valid_samples]
        average_people = sum(people_counts) / len(people_counts) if people_counts else 0.0
        presence_ratio = sum(count > 0 for count in people_counts) / len(people_counts) if people_counts else 0.0
        popularity_rank = min(100.0, 100.0 * min(average_people / 2.0, presence_ratio / 0.25))
        overflow_timestamps = [timestamp for timestamp, _, payload in valid_samples if any(flag.get("kind") == "bin_overflow" for flag in payload.get("flags", []))]
        episodes: list[datetime] = []
        last_overflow: datetime | None = None
        for timestamp in overflow_timestamps:
            if last_overflow is None or timestamp - last_overflow >= timedelta(minutes=self.episode_quiet_minutes):
                episodes.append(timestamp)
            last_overflow = timestamp
        overflow_rate = len(episodes) / valid_days if valid_days else 0.0
        return {
            "windowDays": window_days, "sampleIntervalSeconds": self.sample_interval_seconds,
            "validDays": valid_days, "requiredValidDays": window_days, "observedSamples": len(minute_samples),
            "validSamples": len(valid_samples), "coverageReady": valid_days >= window_days,
            "overflowEpisodes": len(episodes), "overflowEpisodesPerDay": round(overflow_rate, 3),
            "overflowRank": round(min(100.0, overflow_rate * 100.0), 1), "overflowThreshold": self.overflow_threshold,
            "averagePeoplePerFrame": round(average_people, 3), "peoplePresentFrameRatio": round(presence_ratio, 4),
            "popularityRank": round(popularity_rank, 1), "popularityThreshold": self.popularity_threshold,
        }

    def decide(self, ranks: dict[str, Any], current: PlacementDecision) -> PlacementDecision:
        """Compatibility transition for legacy multi-day callers."""
        overflow_pass = ranks["overflowRank"] >= self.overflow_threshold
        popularity_pass = ranks["popularityRank"] >= self.popularity_threshold
        passing = ranks["coverageReady"] and (overflow_pass or popularity_pass)
        recommended, trigger_reason = current.recommended, current.trigger_reason
        raise_streak, clear_streak = current.raise_streak, current.clear_streak
        if recommended:
            below_clear = ranks["coverageReady"] and ranks["overflowRank"] < self.overflow_threshold - self.clear_margin and ranks["popularityRank"] < self.popularity_threshold - self.clear_margin
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


# Existing imports use PlacementPolicy; retain that adapter while exposing the
# narrower domain name for new callers.
PlacementPolicy = BinReplacementPolicy
DEFAULT_PLACEMENT_POLICY = BinReplacementPolicy()


def calculate_placement_ranks(rows: list[tuple[str, int, str]], window_days: int = 3, min_hours_per_day: int = 8) -> dict[str, Any]:
    """Compatibility wrapper for the legacy multi-day report."""
    return BinReplacementPolicy(min_hours_per_day=min_hours_per_day).rank(rows, window_days)
