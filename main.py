import time

import config
from espnow_serial import EspNowSerialBridge
from light_engine import LightEngine
from state_machine import FireflyStateMachine


def main():
    state_machine = FireflyStateMachine()
    light_engine = LightEngine()
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
    )

    print("Home Firefly Engine starting")
    print(f"Control rate: {config.FRAME_RATE:g} fps")
    print(f"Serial bridge: {config.SERIAL_PORT} @ {config.SERIAL_BAUDRATE}")

    try:
        bridge.connect()
        while True:
            bridge.read_available()

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
                homecoming_remaining=snapshot["homecoming_remaining"],
                now=now,
            )
            bridge.send_control_frame(frame)
            time.sleep(config.FRAME_INTERVAL)
    except KeyboardInterrupt:
        print("\nHome Firefly Engine stopping")
    finally:
        bridge.disconnect()


if __name__ == "__main__":
    main()
