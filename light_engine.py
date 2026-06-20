import time

import config
from state_machine import FireflyState


def _clamp(value, lower=0.0, upper=1.0):
    return max(lower, min(upper, value))


def _mix(a, b, amount):
    return a + (b - a) * amount


class LightEngine:
    def __init__(self):
        self._frame_index = 0

    def render(
        self,
        state,
        people_count,
        heart_rate,
        people_positions=None,
        homecoming_remaining=0.0,
        now=None,
    ):
        now = time.monotonic() if now is None else now
        state_value = state.value if isinstance(state, FireflyState) else str(state)
        base_brightness = self._brightness_from_people_count(people_count)
        people_positions = people_positions or []

        self._frame_index += 1
        return {
            "type": "control",
            "frame": self._frame_index,
            "state": state_value,
            "people_count": int(people_count),
            "heart_rate": round(float(heart_rate), 2),
            "brightness": round(base_brightness, 4),
            "idle_brightness": round(config.IDLE_BRIGHTNESS, 4),
            "presence_radius": round(config.PRESENCE_RADIUS, 4),
            "people_positions": people_positions[: config.MAX_PRESENCE_POINTS],
            "tower_x": config.TOWER_COORD[0],
            "tower_y": config.TOWER_COORD[1],
            "pulse_x": config.PULSE_CENTER[0],
            "pulse_y": config.PULSE_CENTER[1],
            "pulse_radius": config.PULSE_RADIUS,
            "homecoming_remaining": round(float(homecoming_remaining), 2),
            "generated_at": round(time.time(), 3),
        }

    def _brightness_from_people_count(self, people_count):
        crowd_level = _clamp(
            people_count / max(1, config.PEOPLE_COUNT_MAX_FOR_BRIGHTNESS)
        )
        return _mix(config.MIN_BRIGHTNESS, config.MAX_BRIGHTNESS, crowd_level)
