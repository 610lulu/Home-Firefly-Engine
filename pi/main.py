"""
Spiral Firefly v2 - Pi 5 main loop
Detects people, computes segment intensity, and drives WLED via HTTP.
"""

import math
import time

import yaml

from camera import PiCameraStream
from detector import PeopleDetector
from sim_server import SimBroadcaster
from wled_client import WLEDClient


def load_config(path="config.yaml"):
    with open(path, "r", encoding="utf-8") as f:
        return yaml.safe_load(f)


def clamp(value, low=0.0, high=1.0):
    return max(low, min(high, value))


class HomecomingState:
    def __init__(self, cfg):
        self.mode = "normal"
        self.started_at = 0.0
        self.cooldown_until = 0.0
        self.threshold = cfg["homecoming"]["people_threshold"]
        self.duration = cfg["homecoming"]["duration_sec"]
        self.cooldown = cfg["homecoming"]["cooldown_sec"]

    def update(self, people_count, now):
        if self.mode == "homecoming":
            if now - self.started_at >= self.duration:
                self.mode = "cooldown"
                self.cooldown_until = now + self.cooldown
        elif self.mode == "cooldown":
            if now >= self.cooldown_until:
                self.mode = "normal"
        elif people_count > self.threshold:
            self.mode = "homecoming"
            self.started_at = now

        return self.mode

    def progress(self, now):
        if self.mode != "homecoming":
            return 0.0
        return clamp((now - self.started_at) / self.duration)


def distance_factor(person, cfg):
    """Estimate response strength from apparent bbox size."""
    h = person["bbox_height"]
    area = person["bbox_area"]
    bands = cfg["interaction"]["distance_bands"]
    if h >= bands["near"]["bbox_height"] or area >= bands["near"]["bbox_area"]:
        return bands["near"]["factor"]
    if h >= bands["mid"]["bbox_height"] or area >= bands["mid"]["bbox_area"]:
        return bands["mid"]["factor"]
    if h >= bands["far"]["bbox_height"] or area >= bands["far"]["bbox_area"]:
        return bands["far"]["factor"]
    return 0.0


def height_level(person, cfg):
    """Map normalized bbox height to one of the 6 physical LED segments."""
    bbox_height = person["bbox_height"]
    for level in cfg["interaction"]["height_levels"]:
        if bbox_height <= level["max_bbox_height"]:
            return level["segment"]
    return cfg["regions"]["count"] - 1


def compute_metrics(people, cfg):
    seg_count = cfg["regions"]["count"]
    intensities = [0.0] * seg_count
    region_counts = [0] * seg_count
    mapped_people = []

    for person in people:
        person_distance = distance_factor(person, cfg)
        person_height = height_level(person, cfg)
        person_intensity = person_distance * person["confidence"]
        intensities[person_height] += person_intensity
        if 0 <= person["region"] < seg_count:
            region_counts[person["region"]] += 1
        mapped_people.append({
            **person,
            "distance_factor": person_distance,
            "height_level": person_height,
            "segment_intensity": clamp(person_intensity),
        })

    crowd_max = cfg["interaction"]["crowd_max"]
    crowd_factor = clamp(math.sqrt(len(people) / crowd_max)) if people else 0.0
    for i in range(seg_count):
        intensities[i] = clamp(intensities[i] * max(crowd_factor, 0.25 if people else 0.0))

    return {
        "people_count": len(people),
        "people": mapped_people,
        "region_counts": region_counts,
        "distance_factor": max((p["distance_factor"] for p in mapped_people), default=0.0),
        "height_level": max((p["height_level"] for p in mapped_people), default=None),
        "segment_intensity": intensities,
    }


def smooth_segments(previous, target, cfg, dt):
    smoothing = cfg["interaction"]["intensity_smoothing"]
    alpha = 1.0 - math.exp(-dt * smoothing)
    return [current + (wanted - current) * alpha for current, wanted in zip(previous, target)]


def apply_breathing(intensities, metrics, cfg, now):
    breath_cfg = cfg["interaction"]["breath"]
    wave = math.sin(now * math.tau * breath_cfg["frequency_hz"])
    amp = breath_cfg["max_amplitude"] * metrics["distance_factor"]
    return [clamp(value * (1.0 + wave * amp)) for value in intensities]


def homecoming_segments(cfg, homecoming, now):
    seg_count = cfg["regions"]["count"]
    progress = homecoming.progress(now)
    width = 0.36
    values = []
    for i in range(seg_count):
        center = i / max(1, seg_count - 1)
        distance = abs(center - progress)
        values.append(clamp(1.0 - distance / width))
    return values


def segments_to_wled(intensities, cfg, homecoming_active=False):
    min_bri = cfg["interaction"]["segment_min_bri"]
    max_bri = cfg["interaction"]["segment_max_bri"]
    active_color = cfg["wled"]["homecoming_color"] if homecoming_active else cfg["wled"]["active_color"]
    segs = []
    for i, intensity in enumerate(intensities):
        bri = round(min_bri + clamp(intensity) * (max_bri - min_bri))
        segs.append({
            "id": i,
            "on": True,
            "bri": bri,
            "col": active_color if intensity > 0.02 else cfg["wled"]["idle_color"],
            "fx": 0,
            "sx": 0,
        })
    return segs


def main():
    cfg = load_config()
    print(f"[v2] starting, target={cfg['wled']['host']}")

    detector = PeopleDetector(
        model_path=cfg["yolo"]["model"],
        region_count=cfg["regions"]["count"],
        imgsz=cfg["yolo"]["imgsz"],
        conf=cfg["yolo"]["conf"],
    )
    camera = PiCameraStream(width=cfg["camera"]["width"], height=cfg["camera"]["height"])
    wled = WLEDClient(host=cfg["wled"]["host"], led_count=cfg["wled"]["led_count"])
    sim = SimBroadcaster(port=cfg["sim"]["ws_port"]) if cfg["sim"]["enabled"] else None
    homecoming = HomecomingState(cfg)

    fps_target = cfg["loop"]["fps_target"]
    frame_interval = 1.0 / fps_target
    segment_state = [0.0] * cfg["regions"]["count"]
    last_loop = time.monotonic()

    try:
        while True:
            loop_start = time.monotonic()
            dt = loop_start - last_loop
            last_loop = loop_start

            frame = camera.read()
            people = detector.detect(frame)
            metrics = compute_metrics(people, cfg)
            mode = homecoming.update(metrics["people_count"], loop_start)

            if mode == "homecoming":
                output_intensity = homecoming_segments(cfg, homecoming, loop_start)
            else:
                segment_state = smooth_segments(segment_state, metrics["segment_intensity"], cfg, dt)
                output_intensity = apply_breathing(segment_state, metrics, cfg, loop_start)

            homecoming_trigger = mode == "homecoming"
            segs = segments_to_wled(output_intensity, cfg, homecoming_trigger)
            wled.set_segments(segs)

            state = {
                "ts": time.time(),
                "mode": mode,
                "people_count": metrics["people_count"],
                "distance_factor": metrics["distance_factor"],
                "height_level": metrics["height_level"],
                "segment_intensity": output_intensity,
                "homecoming_trigger": homecoming_trigger,
                "people": metrics["people"],
                "region_counts": metrics["region_counts"],
                "segments": segs,
            }
            if sim:
                sim.broadcast(state)

            elapsed = time.monotonic() - loop_start
            sleep = max(0, frame_interval - elapsed)
            if sleep > 0:
                time.sleep(sleep)

    except KeyboardInterrupt:
        print("\n[v2] stopping")
    finally:
        camera.close()
        if sim:
            sim.close()


if __name__ == "__main__":
    main()
