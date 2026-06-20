import json
import time

import config

try:
    import serial
except ImportError:
    serial = None


class EspNowSerialBridge:
    def __init__(self, on_people_count, on_heart_rate):
        self.on_people_count = on_people_count
        self.on_heart_rate = on_heart_rate
        self.connection = None

    def connect(self):
        if serial is None:
            raise RuntimeError("pyserial is required. Install it with: pip install pyserial")

        self.connection = serial.Serial(
            port=config.SERIAL_PORT,
            baudrate=config.SERIAL_BAUDRATE,
            timeout=config.SERIAL_TIMEOUT_SECONDS,
            write_timeout=config.SERIAL_WRITE_TIMEOUT_SECONDS,
        )
        time.sleep(config.SERIAL_BOOT_DELAY_SECONDS)
        self.connection.reset_input_buffer()
        print(f"Serial bridge connected on {config.SERIAL_PORT} @ {config.SERIAL_BAUDRATE}")

    def disconnect(self):
        if self.connection and self.connection.is_open:
            self.connection.close()

    def read_available(self):
        if not self.connection or not self.connection.is_open:
            return

        lines_read = 0
        while self.connection.in_waiting and lines_read < config.SERIAL_MAX_LINES_PER_TICK:
            raw_line = self.connection.readline()
            if not raw_line:
                break
            self._handle_line(raw_line)
            lines_read += 1

    def send_control_frame(self, frame):
        if not self.connection or not self.connection.is_open:
            return

        payload = json.dumps(frame, separators=(",", ":"))
        self.connection.write(payload.encode("utf-8") + b"\n")

    def _handle_line(self, raw_line):
        line = raw_line.decode("utf-8", errors="replace").strip()
        if not line:
            return

        try:
            message = json.loads(line)
        except json.JSONDecodeError:
            print(f"bridge: {line}")
            return

        message_type = message.get("type")
        if message_type in ("bridge_status", "espnow_status"):
            print(f"bridge status: {message}")
            return

        if "people_count" in message:
            self.on_people_count(message["people_count"])
        elif message_type == "people_count" and "value" in message:
            self.on_people_count(message["value"])

        if "heart_rate" in message:
            self.on_heart_rate(message["heart_rate"])
        elif message_type == "heart_rate" and "value" in message:
            self.on_heart_rate(message["value"])
