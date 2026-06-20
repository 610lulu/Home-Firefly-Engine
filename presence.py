import math
import time

import config


class PresenceTracker:
    def __init__(
        self,
        max_points=config.MAX_PRESENCE_POINTS,
        timeout=config.PRESENCE_TIMEOUT_SECONDS,
    ):
        self.max_points = max_points
        self.timeout = timeout
        self._zones = {}

    def update_zone(self, zone_id, x, y, people_count=1, now=None):
        now = time.monotonic() if now is None else now
        if people_count <= 0:
            self._zones.pop(zone_id, None)
            return

        self._zones[zone_id] = {
            "x": self._clamp(x),
            "y": self._clamp(y),
            "weight": max(1, int(people_count)),
            "last_seen": now,
        }

    def active_points(self, now=None):
        now = time.monotonic() if now is None else now
        stale_zone_ids = [
            zone_id
            for zone_id, zone in self._zones.items()
            if now - zone["last_seen"] > self.timeout
        ]
        for zone_id in stale_zone_ids:
            self._zones.pop(zone_id, None)

        zones = sorted(
            self._zones.values(),
            key=lambda zone: (zone["weight"], zone["last_seen"]),
            reverse=True,
        )
        return [
            {
                "x": round(zone["x"], 4),
                "y": round(zone["y"], 4),
                "weight": zone["weight"],
            }
            for zone in zones[: self.max_points]
        ]

    def demo_points(self, people_count, now=None):
        now = time.monotonic() if now is None else now
        if people_count <= 0:
            return []

        point_count = min(self.max_points, max(1, math.ceil(people_count / 5)))
        points = []
        for index in range(point_count):
            phase = now * (0.18 + index * 0.035) + index * 1.73
            x = 0.5 + math.sin(phase) * (0.24 + index * 0.025)
            y = 0.56 + math.cos(phase * 0.83) * (0.22 - index * 0.015)
            points.append(
                {
                    "x": round(self._clamp(x), 4),
                    "y": round(self._clamp(y), 4),
                    "weight": max(1, people_count // point_count),
                }
            )
        return points

    def _clamp(self, value):
        return max(0.0, min(1.0, float(value)))
