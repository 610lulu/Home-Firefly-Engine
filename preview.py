import json
import math
from pathlib import Path
import time
import tkinter as tk

import config
from state_machine import FireflyState


def _clamp(value, lower=0.0, upper=1.0):
    return max(lower, min(upper, value))


def _mix(a, b, amount):
    return a + (b - a) * amount


class LightPreview:
    def __init__(
        self,
        light_count=120,
        width=860,
        height=560,
        layout_file="",
        background_image="",
        show_labels=False,
    ):
        self.light_count = light_count
        self.width = width
        self.height = height
        self.margin = 42
        self.layout = self._load_layout(layout_file)
        self.background_path = background_image or self.layout.get("background", "")
        self.positions = self._layout_positions(light_count, self.layout)
        self.labels = self._layout_labels(self.positions, self.layout)
        self.show_labels = show_labels or bool(self.layout.get("show_labels", False))
        self.closed = False

        self.root = tk.Tk()
        self.root.title("Home Firefly Engine Preview")
        self.root.protocol("WM_DELETE_WINDOW", self.close)

        self.canvas = tk.Canvas(
            self.root,
            width=self.width,
            height=self.height,
            bg="#111318",
            highlightthickness=0,
        )
        self.canvas.pack(fill=tk.BOTH, expand=True)

        self.background_photo = None
        self._draw_background()

        self.status_text = self.canvas.create_text(
            self.margin,
            24,
            anchor="w",
            fill="#E8EEF7",
            font=("Segoe UI", 12),
            text="waiting",
        )
        self.tower_marker = None
        self.light_items = []
        self.label_items = []
        for _ in self.positions:
            item = self.canvas.create_oval(0, 0, 0, 0, outline="")
            self.light_items.append(item)
        for label in self.labels:
            item = self.canvas.create_text(
                0,
                0,
                anchor="center",
                fill="#F5F7FA",
                font=("Segoe UI", 8),
                text=label,
                state=tk.NORMAL if self.show_labels else tk.HIDDEN,
            )
            self.label_items.append(item)

    def update(self, frame):
        if self.closed:
            return

        now = time.monotonic()
        lights = self._render_lights(frame, now)
        for item, light in zip(self.light_items, lights):
            x, y = self._to_canvas(light["x"], light["y"])
            radius = 4 + light["brightness"] * 10
            color = self._hex(light["r"], light["g"], light["b"], light["brightness"])
            self.canvas.coords(item, x - radius, y - radius, x + radius, y + radius)
            self.canvas.itemconfig(item, fill=color)
            if self.show_labels:
                self.canvas.coords(self.label_items[light["id"]], x, y - radius - 9)

        tower_x = frame.get("tower_x", config.TOWER_COORD[0])
        tower_y = frame.get("tower_y", config.TOWER_COORD[1])
        tx, ty = self._to_canvas(tower_x, tower_y)
        if self.tower_marker is None:
            self.tower_marker = self.canvas.create_oval(
                tx - 7,
                ty - 7,
                tx + 7,
                ty + 7,
                outline="#A8F0FF",
                width=2,
            )
        else:
            self.canvas.coords(self.tower_marker, tx - 7, ty - 7, tx + 7, ty + 7)

        state = frame.get("state", "waiting")
        status = (
            f"state={state}  people={frame.get('people_count', 0)}  "
            f"heart={frame.get('heart_rate', 0)}  "
            f"brightness={frame.get('brightness', 0):.2f}"
        )
        if state == FireflyState.HOMECOMING.value:
            status += f"  remaining={frame.get('homecoming_remaining', 0):.1f}s"
        self.canvas.itemconfig(self.status_text, text=status)

        self.root.update_idletasks()
        self.root.update()

    def close(self):
        self.closed = True
        self.root.destroy()

    def _render_lights(self, frame, now):
        state = frame.get("state", FireflyState.WAITING.value)
        base_brightness = _clamp(frame.get("brightness", config.MIN_BRIGHTNESS))

        if state == FireflyState.HOMECOMING.value:
            return self._render_homecoming(frame, base_brightness, now)
        if state == FireflyState.PULSE.value:
            return self._render_pulse(frame, base_brightness, now)
        return self._render_waiting(base_brightness, now)

    def _render_waiting(self, base_brightness, now):
        lights = []
        for light_id, position in enumerate(self.positions):
            flicker = 0.92 + 0.08 * math.sin(now * 1.7 + light_id * 0.61)
            lights.append(self._light(light_id, position, 255, 176, 72, base_brightness * flicker))
        return lights

    def _render_pulse(self, frame, base_brightness, now):
        heart_rate = _clamp(float(frame.get("heart_rate", 0)), 40.0, 180.0)
        beat_frequency = heart_rate / 60.0
        breath = 0.5 - 0.5 * math.cos(now * beat_frequency * math.tau)
        breath = breath * breath
        pulse_center = (
            frame.get("pulse_x", config.PULSE_CENTER[0]),
            frame.get("pulse_y", config.PULSE_CENTER[1]),
        )
        pulse_radius = frame.get("pulse_radius", config.PULSE_RADIUS)

        lights = []
        for light_id, position in enumerate(self.positions):
            pulse_distance = self._distance(position, pulse_center)
            pulse_influence = _clamp(1.0 - pulse_distance / pulse_radius)
            local_pulse = breath * pulse_influence
            flicker = 0.9 + 0.1 * math.sin(now * 1.3 + light_id * 0.47)
            brightness = _clamp(base_brightness * flicker + local_pulse * 0.55)
            lights.append(
                self._light(
                    light_id,
                    position,
                    255,
                    _mix(176, 66, local_pulse),
                    _mix(72, 122, local_pulse),
                    brightness,
                )
            )
        return lights

    def _render_homecoming(self, frame, base_brightness, now):
        tower = (
            frame.get("tower_x", config.TOWER_COORD[0]),
            frame.get("tower_y", config.TOWER_COORD[1]),
        )
        max_distance = max(self._distance(position, tower) for position in self.positions)
        max_distance = max(max_distance, 0.001)

        lights = []
        for light_id, position in enumerate(self.positions):
            distance_to_tower = self._distance(position, tower)
            normalized_distance = distance_to_tower / max_distance
            flow_phase = (normalized_distance * 3.5 + now * 0.72) % 1.0
            wave = 1.0 - min(flow_phase, 1.0 - flow_phase) * 2.0
            wave = max(0.0, wave) ** 2.7
            tower_glow = (1.0 - normalized_distance) ** 1.7
            brightness = _clamp(base_brightness * 0.48 + wave * 0.78 + tower_glow * 0.35)
            flow_mix = _clamp(wave + tower_glow * 0.55)
            lights.append(
                self._light(
                    light_id,
                    position,
                    _mix(255, 118, flow_mix),
                    _mix(176, 224, flow_mix),
                    _mix(72, 255, flow_mix),
                    brightness,
                )
            )
        return lights

    def _light(self, light_id, position, red, green, blue, brightness):
        return {
            "id": light_id,
            "x": position[0],
            "y": position[1],
            "r": int(_clamp(red, 0, 255)),
            "g": int(_clamp(green, 0, 255)),
            "b": int(_clamp(blue, 0, 255)),
            "brightness": _clamp(brightness),
        }

    def _build_light_positions(self, light_count):
        columns = max(1, math.ceil(math.sqrt(light_count)))
        rows = max(1, math.ceil(light_count / columns))
        positions = []
        for light_id in range(light_count):
            row = light_id // columns
            column = light_id % columns
            x = column / max(1, columns - 1)
            y = row / max(1, rows - 1)
            positions.append((x, y))
        return positions

    def _load_layout(self, layout_file):
        if not layout_file:
            return {}

        path = Path(layout_file)
        if not path.is_absolute():
            path = Path.cwd() / path
        try:
            with path.open("r", encoding="utf-8") as file:
                layout = json.load(file)
        except OSError as exc:
            print(f"Preview layout could not be read: {path} ({exc})")
            return {}
        except json.JSONDecodeError as exc:
            print(f"Preview layout is not valid JSON: {path} ({exc})")
            return {}

        layout["_base_dir"] = path.parent
        return layout

    def _layout_positions(self, light_count, layout):
        lights = layout.get("lights")
        if not lights:
            return self._build_light_positions(light_count)

        ordered_lights = sorted(lights, key=lambda item: int(item.get("id", 0)))
        positions = []
        for light in ordered_lights:
            positions.append(
                (
                    _clamp(float(light.get("x", 0.0))),
                    _clamp(float(light.get("y", 0.0))),
                )
            )
        self.light_count = len(positions)
        return positions

    def _layout_labels(self, positions, layout):
        lights = layout.get("lights") or []
        if not lights:
            return [str(index) for index, _ in enumerate(positions)]

        ordered_lights = sorted(lights, key=lambda item: int(item.get("id", 0)))
        labels = []
        for index, light in enumerate(ordered_lights):
            labels.append(str(light.get("name") or light.get("id", index)))
        return labels

    def _draw_background(self):
        if not self.background_path:
            return

        path = Path(self.background_path)
        if not path.is_absolute():
            base_dir = self.layout.get("_base_dir") or Path.cwd()
            path = Path(base_dir) / path
        try:
            self.background_photo = tk.PhotoImage(file=str(path))
        except tk.TclError as exc:
            print(f"Preview background could not be loaded: {path} ({exc})")
            return

        image_width = self.background_photo.width()
        image_height = self.background_photo.height()
        self.width = max(self.width, image_width + self.margin * 2)
        self.height = max(self.height, image_height + self.margin * 2)
        self.canvas.config(width=self.width, height=self.height)
        self.canvas.create_image(
            self.margin,
            self.margin,
            image=self.background_photo,
            anchor="nw",
        )

    def _to_canvas(self, x, y):
        drawable_width = self.width - self.margin * 2
        drawable_height = self.height - self.margin * 2
        return (
            self.margin + x * drawable_width,
            self.margin + y * drawable_height,
        )

    def _hex(self, red, green, blue, brightness):
        level = 0.18 + _clamp(brightness) * 0.82
        return "#{:02x}{:02x}{:02x}".format(
            int(red * level),
            int(green * level),
            int(blue * level),
        )

    def _distance(self, a, b):
        return math.hypot(a[0] - b[0], a[1] - b[1])
