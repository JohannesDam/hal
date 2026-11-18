"""HAL's sight: one look through the webcam, reduced to a few numbers, the frame thrown away.

    python hal-sight.py [--camera <index>]

Opt-in only (/hal see on). The camera opens for about a second (its light shows), a handful of
frames let the exposure settle, the last one is measured, and the camera is released. Nothing is
written to disk and no pixel leaves this process: stdout gets one JSON line of facts.

  {"t": "seen", "faces": n, "near": 0..1, "side": "left"|"centre"|"right",
   "light": 0..1, "warm": -1..1, "backlit": bool, "camera": index}
  {"t": "blind", "why": "..."}

faces    how many faces YuNet finds (score >= 0.8); "someone else" is all HAL may make of a second
near     the largest face's width as a share of the frame: about 0.15 at arm's length, 0.3 close
side     where that face is, as the guest sees the screen (the image is mirrored for that)
light    mean brightness of the frame; warm: red against blue (lamp light > 0, daylight < 0)
backlit  the background is much brighter than the face
"""

import json
import os
import sys
import time
from pathlib import Path

MODEL = Path(os.environ.get("LOCALAPPDATA", ".")) / "hal" / "models" / "sight" / "face_detection_yunet_2023mar.onnx"


def say(message: dict) -> None:
    sys.stdout.write(json.dumps(message) + "\n")
    sys.stdout.flush()


def measure(frame, detector) -> dict:
    """The facts of one BGR frame. Pure: no camera, so it can be tested."""
    import numpy as np

    h, w = frame.shape[:2]
    gray = frame.mean(axis=2)
    light = float(gray.mean() / 255.0)
    b, _, r = (float(frame[:, :, i].mean()) for i in range(3))
    warm = float(np.clip((r - b) / max(1.0, r + b) * 4.0, -1.0, 1.0))
    faces = []
    if detector is not None:
        detector.setInputSize((w, h))
        _, found = detector.detect(frame)
        if found is not None:
            faces = [f for f in found if float(f[14]) >= 0.8]
    facts = {"t": "seen", "faces": len(faces), "light": round(light, 3), "warm": round(warm, 3)}
    if faces:
        x, y, fw, fh = (float(v) for v in max(faces, key=lambda f: float(f[2]))[:4])
        centre = (x + fw / 2) / w
        # The webcam sees the guest mirrored: their left is the image's right.
        mirrored = 1.0 - centre
        facts["near"] = round(fw / w, 3)
        facts["side"] = "left" if mirrored < 0.38 else "right" if mirrored > 0.62 else "centre"
        x0, y0 = max(0, int(x)), max(0, int(y))
        face = gray[y0 : y0 + int(fh), x0 : x0 + int(fw)]
        mask = np.ones_like(gray, dtype=bool)
        mask[y0 : y0 + int(fh), x0 : x0 + int(fw)] = False
        facts["backlit"] = bool(face.size and gray[mask].mean() > face.mean() * 1.35)
    return facts


def look(index: int) -> dict:
    import cv2

    detector = None
    if MODEL.exists():
        detector = cv2.FaceDetectorYN.create(str(MODEL), "", (320, 240), 0.8, 0.3, 5)
    camera = cv2.VideoCapture(index, cv2.CAP_MSMF)
    if not camera.isOpened():
        camera = cv2.VideoCapture(index, cv2.CAP_DSHOW)
    if not camera.isOpened():
        return {"t": "blind", "why": "no camera, or another app holds it"}
    try:
        camera.set(cv2.CAP_PROP_FRAME_WIDTH, 640)
        camera.set(cv2.CAP_PROP_FRAME_HEIGHT, 480)
        frame = None
        started = time.monotonic()
        # Let the exposure settle: about ten frames, at most two seconds.
        for _ in range(12):
            ok, image = camera.read()
            if ok:
                frame = image
            if time.monotonic() - started > 2.0:
                break
    finally:
        camera.release()
    if frame is None:
        return {"t": "blind", "why": "the camera gave no picture"}
    facts = measure(frame, detector)
    del frame
    facts["camera"] = index
    return facts


def main() -> None:
    args = sys.argv[1:]
    index = int(args[args.index("--camera") + 1]) if "--camera" in args else 0
    try:
        say(look(index))
    except Exception as error:  # a broken camera never breaks HAL
        say({"t": "blind", "why": str(error)})


if __name__ == "__main__":
    main()
