"""
Spiral Firefly v2 - Pi 5 main loop
Detects people in 6 regions, drives WLED via HTTP.
"""

import time
import yaml
import requests
from detector import PeopleDetector
from camera import PiCameraStream
from wled_client import WLEDClient
from sim_server import SimBroadcaster


def load_config(path="config.yaml"):
    with open(path, "r", encoding="utf-8") as f:
        return yaml.safe_load(f)


def people_to_regions(active_regions, cfg):
    """Map active region indices to WLED segment config."""
    segs = []
    for i in range(cfg["regions"]["count"]):
        if i in active_regions:
            segs.append({
                "id": i,
                "on": True,
                "bri": cfg["wled"]["active_bri"],
                "col": cfg["wled"]["active_color"],
                "fx": cfg["wled"]["active_fx"],
                "sx": cfg["wled"]["active_sx"],
            })
        else:
            segs.append({
                "id": i,
                "on": True,
                "bri": cfg["wled"]["idle_bri"],
                "col": cfg["wled"]["idle_color"],
                "fx": 0,
                "sx": 0,
            })
    return segs


def main():
    cfg = load_config()
    print(f"[v2] starting, target={cfg['wled']['host']}")

    detector = PeopleDetector(model_path=cfg["yolo"]["model"])
    camera = PiCameraStream(width=cfg["camera"]["width"], height=cfg["camera"]["height"])
    wled = WLEDClient(host=cfg["wled"]["host"], led_count=cfg["wled"]["led_count"])
    sim = SimBroadcaster(port=cfg["sim"]["ws_port"]) if cfg["sim"]["enabled"] else None

    fps_target = cfg["loop"]["fps_target"]
    frame_interval = 1.0 / fps_target

    try:
        while True:
            loop_start = time.monotonic()

            frame = camera.read()
            active = detector.detect(frame)
            regions = sorted(active)

            segs = people_to_regions(set(regions), cfg)
            wled.set_segments(segs)

            if sim:
                sim.broadcast({
                    "ts": time.time(),
                    "active_regions": regions,
                    "segments": segs,
                })

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
