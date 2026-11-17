"""Piper voices through the piper-tts package, for HAL's voice process.

A Piper voice is a folder %LOCALAPPDATA%\\hal\\models\\piper\\<name> with <name>.onnx and
<name>.onnx.json (see tools/setup-voice.ps1). piper-tts phonemizes with its own espeak-ng,
the same way the voice was trained; sherpa-onnx 2.0 no longer ships espeak-ng for VITS.
"""

import os
import re
from pathlib import Path

import numpy as np

MODELS = Path(os.environ.get("LOCALAPPDATA", ".")) / "hal" / "models" / "piper"


def model_path(name: str) -> Path:
    return MODELS / name / f"{name}.onnx"


def is_set_up(name: str) -> bool:
    path = model_path(name)
    return path.is_file() and path.with_suffix(".onnx.json").is_file()


def make_voice(name: str):
    from piper import PiperVoice  # only where a Piper voice is set up

    path = model_path(name)
    return PiperVoice.load(str(path), config_path=str(path.with_suffix(".onnx.json")))


def say(voice, text: str, speed: float) -> tuple[np.ndarray, int]:
    """One line as samples. "..." becomes 700 ms of real silence, as with Kokoro."""
    from piper import SynthesisConfig

    rate = voice.config.sample_rate
    config = SynthesisConfig(length_scale=1.0 / max(speed, 0.1))
    parts = [p for p in re.split(r"\s*(?:\.\.\.|…)\s*", text) if p.strip()]
    chunks = []
    for i, part in enumerate(parts):
        if i > 0:
            chunks.append(np.zeros(int(0.7 * rate), dtype=np.float32))
        for chunk in voice.synthesize(part, syn_config=config):
            chunks.append(np.asarray(chunk.audio_float_array, dtype=np.float32))
    if not chunks:
        return np.zeros(1, dtype=np.float32), rate
    return np.concatenate(chunks), rate
