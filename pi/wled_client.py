"""
WLED HTTP client. POSTs segment state to /json endpoint.
"""

import requests


class WLEDClient:
    def __init__(self, host="192.168.1.50", led_count=300, timeout=1.0):
        self.url = f"http://{host}/json"
        self.led_count = led_count
        self.timeout = timeout
        self.session = requests.Session()

    def set_segments(self, segs: list[dict]) -> None:
        payload = {"seg": segs}
        try:
            self.session.post(self.url, json=payload, timeout=self.timeout)
        except requests.RequestException as e:
            print(f"[wled] POST failed: {e}")

    def set_full(self, on=True, bri=255, col=None, fx=0, sx=128) -> None:
        payload = {
            "on": on,
            "bri": bri,
            "seg": [{"col": [col or [255, 176, 72]], "fx": fx, "sx": sx}],
        }
        try:
            self.session.post(self.url, json=payload, timeout=self.timeout)
        except requests.RequestException as e:
            print(f"[wled] POST failed: {e}")
