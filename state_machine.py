import time
from enum import Enum
from threading import RLock

import config


class FireflyState(str, Enum):
    WAITING = "waiting"
    PULSE = "pulse"
    HOMECOMING = "homecoming"


class FireflyStateMachine:
    def __init__(
        self,
        homecoming_threshold=config.HOMECOMING_THRESHOLD,
        homecoming_duration=config.HOMECOMING_DURATION_SECONDS,
        heart_rate_timeout=config.HEART_RATE_TIMEOUT_SECONDS,
    ):
        self.homecoming_threshold = homecoming_threshold
        self.homecoming_duration = homecoming_duration
        self.heart_rate_timeout = heart_rate_timeout

        self.state = FireflyState.WAITING
        self.people_count = 0
        self.heart_rate = 0.0
        self.last_heart_rate_at = 0.0

        self._homecoming_until = None
        self._ready_for_next_homecoming = True
        self._lock = RLock()

    def update_people_count(self, value, now=None):
        now = time.monotonic() if now is None else now
        count = max(0, int(value))

        with self._lock:
            self.people_count = count

            if count <= self.homecoming_threshold:
                self._ready_for_next_homecoming = True
                return self.state

            if (
                self._ready_for_next_homecoming
                and self.state != FireflyState.HOMECOMING
            ):
                self._start_homecoming(now)

            return self.state

    def update_heart_rate(self, value, now=None):
        now = time.monotonic() if now is None else now
        heart_rate = max(0.0, float(value))

        with self._lock:
            self.heart_rate = heart_rate
            self.last_heart_rate_at = now

            if self.state != FireflyState.HOMECOMING and heart_rate > 0:
                self.state = FireflyState.PULSE

            return self.state

    def tick(self, now=None):
        now = time.monotonic() if now is None else now

        with self._lock:
            if self.state == FireflyState.HOMECOMING:
                if self._homecoming_until is not None and now >= self._homecoming_until:
                    self.state = FireflyState.WAITING
                    self._homecoming_until = None
                return self.state

            heart_rate_is_stale = (
                self.last_heart_rate_at == 0
                or now - self.last_heart_rate_at > self.heart_rate_timeout
            )
            if self.state == FireflyState.PULSE and heart_rate_is_stale:
                self.state = FireflyState.WAITING

            return self.state

    def snapshot(self, now=None):
        now = time.monotonic() if now is None else now

        with self._lock:
            remaining = 0.0
            if self.state == FireflyState.HOMECOMING and self._homecoming_until:
                remaining = max(0.0, self._homecoming_until - now)

            return {
                "state": self.state,
                "people_count": self.people_count,
                "heart_rate": self.heart_rate,
                "homecoming_remaining": remaining,
            }

    def _start_homecoming(self, now):
        self.state = FireflyState.HOMECOMING
        self._homecoming_until = now + self.homecoming_duration
        self._ready_for_next_homecoming = False
