"""
Pi Camera V3 Wide (IMX708) capture via Picamera2.
Falls back to OpenCV VideoCapture for non-Pi dev.
"""

import cv2
import numpy as np


class PiCameraStream:
    def __init__(self, width=1280, height=720):
        self.width = width
        self.height = height
        self._use_picamera2 = False
        try:
            from picamera2 import Picamera2
            self.picam2 = Picamera2()
            config = self.picam2.create_video_configuration(
                main={"size": (width, height), "format": "RGB888"}
            )
            self.picam2.configure(config)
            self.picam2.start()
            self._use_picamera2 = True
        except Exception:
            self.cap = cv2.VideoCapture(0)
            self.cap.set(cv2.CAP_PROP_FRAME_WIDTH, width)
            self.cap.set(cv2.CAP_PROP_FRAME_HEIGHT, height)

    def read(self) -> np.ndarray:
        if self._use_picamera2:
            return self.picam2.capture_array()
        ret, frame = self.cap.read()
        if not ret:
            return None
        return cv2.cvtColor(frame, cv2.COLOR_BGR2RGB)

    def close(self):
        if self._use_picamera2:
            self.picam2.close()
        else:
            self.cap.release()
