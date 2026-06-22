"""
YOLOv8n person detector with 6-region frame split.
"""

import cv2
import numpy as np
from ultralytics import YOLO


class PeopleDetector:
    def __init__(self, model_path="yolov8n.pt", region_count=6, imgsz=640, conf=0.4):
        self.model = YOLO(model_path)
        self.region_count = region_count
        self.imgsz = imgsz
        self.conf = conf
        # 6 regions = 2 cols x 3 rows
        self.cols = 2
        self.rows = 3

    def detect(self, frame: np.ndarray) -> list[int]:
        """Return list of active region indices (0..region_count-1)."""
        h, w = frame.shape[:2]
        results = self.model(frame, imgsz=self.imgsz, classes=[0], conf=self.conf, verbose=False)
        active = set()
        for box in results[0].boxes:
            x1, y1, x2, y2 = box.xyxy[0].cpu().numpy()
            cx = (x1 + x2) / 2.0
            cy = (y1 + y2) / 2.0
            col = 0 if cx < w / 2 else 1
            row = min(self.rows - 1, int(cy / h * self.rows))
            active.add(row * self.cols + col)
        return sorted(active)
