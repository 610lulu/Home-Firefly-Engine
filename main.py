import argparse
import math
import time

import config
from espnow_serial import EspNowSerialBridge
from light_engine import LightEngine
from presence import PresenceTracker
from state_machine import FireflyStateMachine


def main():
    args = parse_args()
    state_machine = FireflyStateMachine()
    light_engine = LightEngine()
    presence = PresenceTracker()
    preview = create_preview(args)
    last_state = None

    def handle_people_count(value):
        state = state_machine.update_people_count(value)
        print(f"people_count={state_machine.snapshot()['people_count']} state={state.value}")

    def handle_heart_rate(value):
        state = state_machine.update_heart_rate(value)
        print(f"heart_rate={state_machine.snapshot()['heart_rate']:.1f} state={state.value}")

    bridge = EspNowSerialBridge(
        on_people_count=handle_people_count,
        on_heart_rate=handle_heart_rate,
        on_presence=presence.update_zone,
    )

    print("Home Firefly Engine starting")
    print(f"Control rate: {config.FRAME_RATE:g} fps")
    print(f"Serial bridge: {config.SERIAL_PORT} @ {config.SERIAL_BAUDRATE}")
    if preview:
        print(f"Preview enabled: {config.PREVIEW_LIGHTS} virtual lights")

    try:
        if not args.preview_only:
            bridge.connect()
        while True:
            if preview and preview.closed and args.preview_only:
                break

            if not args.preview_only:
                bridge.read_available()
                people_positions = presence.active_points()
            else:
                run_preview_demo_inputs(state_machine)
                people_positions = presence.demo_points(
                    state_machine.snapshot()["people_count"]
                )

            now = time.monotonic()
            state_machine.tick(now)
            snapshot = state_machine.snapshot(now)

            state = snapshot["state"]
            if state != last_state:
                remaining = snapshot["homecoming_remaining"]
                suffix = f" ({remaining:.1f}s remaining)" if remaining else ""
                print(f"state -> {state.value}{suffix}")
                last_state = state

            frame = light_engine.render(
                state=state,
                people_count=snapshot["people_count"],
                heart_rate=snapshot["heart_rate"],
                people_positions=people_positions,
                homecoming_remaining=snapshot["homecoming_remaining"],
                now=now,
            )
            if not args.preview_only:
                bridge.send_control_frame(frame)
            if preview:
                preview.update(frame)
            time.sleep(config.FRAME_INTERVAL)
    except KeyboardInterrupt:
        print("\nHome Firefly Engine stopping")
    finally:
        bridge.disconnect()


def parse_args():
    parser = argparse.ArgumentParser(description="Home Firefly Engine")
    parser.add_argument(
        "--preview",
        action="store_true",
        help="open a desktop light preview window",
    )
    parser.add_argument(
        "--preview-only",
        action="store_true",
        help="run the preview without connecting to the ESP32 serial bridge",
    )
    parser.add_argument(
        "--preview-layout",
        default=config.PREVIEW_LAYOUT_FILE,
        help="JSON layout file with real light coordinates",
    )
    parser.add_argument(
        "--preview-background",
        default=config.PREVIEW_BACKGROUND_IMAGE,
        help="PNG/GIF drawing or floor plan shown behind the lights",
    )
    parser.add_argument(
        "--preview-labels",
        action="store_true",
        default=config.PREVIEW_SHOW_LABELS,
        help="show light id/name labels in the preview",
    )
    args = parser.parse_args()
    if args.preview_only:
        args.preview = True
    return args


def create_preview(args):
    if not args.preview:
        return None

    from preview import LightPreview

    return LightPreview(
        light_count=config.PREVIEW_LIGHTS,
        layout_file=args.preview_layout,
        background_image=args.preview_background,
        show_labels=args.preview_labels,
    )


def run_preview_demo_inputs(state_machine):
    now = time.monotonic()
    people_count = int(12 + 11 * (0.5 + 0.5 * math.sin(now * 0.12)))
    heart_rate = 78 + 18 * (0.5 + 0.5 * math.sin(now * 0.33))
    state_machine.update_people_count(people_count, now)
    state_machine.update_heart_rate(heart_rate, now)


if __name__ == "__main__":
    main()
