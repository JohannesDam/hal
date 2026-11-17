"""Kokoro through sherpa-onnx, shared by HAL's voice process and the listening test.

The model lives outside the repository, in %LOCALAPPDATA%\\hal\\models\\kokoro (see
tools/setup-voice.ps1). Kokoro's voices are stock voices of the model.
"""

import os
import re
import wave
from pathlib import Path

import numpy as np
import sherpa_onnx

MODEL = Path(os.environ.get("LOCALAPPDATA", ".")) / "hal" / "models" / "kokoro" / "kokoro-multi-lang-v1_0"
STYLE_ROWS, STYLE_DIM = 510, 256

# Kokoro multi-lang v1.0 orders its 54 voices by name.
VOICES = (
    "af_alloy af_aoede af_bella af_heart af_jessica af_kore af_nicole af_nova af_river af_sarah af_sky "
    "am_adam am_echo am_eric am_fenrir am_liam am_michael am_onyx am_puck am_santa "
    "bf_alice bf_emma bf_isabella bf_lily bm_daniel bm_fable bm_george bm_lewis "
    "ef_dora em_alex em_santa ff_siwis hf_alpha hf_beta hm_omega hm_psi if_sara im_nicola "
    "jf_alpha jf_gongitsune jf_nezumi jf_tebukuro jm_kumo pf_dora pm_alex pm_santa "
    "zf_xiaobei zf_xiaoni zf_xiaoxiao zf_xiaoyi zm_yunjian zm_yunxi zm_yunxia zm_yunyang"
).split()


def make_tts(voices: Path | None = None, threads: int = 4) -> sherpa_onnx.OfflineTts:
    lexicons = ",".join(str(p) for p in sorted(MODEL.glob("lexicon-*.txt")))
    config = sherpa_onnx.OfflineTtsConfig(
        model=sherpa_onnx.OfflineTtsModelConfig(
            kokoro=sherpa_onnx.OfflineTtsKokoroModelConfig(
                model=str(MODEL / "model.onnx"),
                voices=str(voices or MODEL / "voices.bin"),
                tokens=str(MODEL / "tokens.txt"),
                data_dir=str(MODEL / "espeak-ng-data"),
                lexicon=lexicons,
                dict_dir=str(MODEL / "dict"),
            ),
            num_threads=threads,
            provider="cpu",
        ),
        max_num_sentences=1,
    )
    return sherpa_onnx.OfflineTts(config)


def say(tts: sherpa_onnx.OfflineTts, text: str, sid: int, speed: float) -> tuple[np.ndarray, int]:
    """One line as samples. "..." becomes 700 ms of real silence; code words are split
    (WebSocket -> Web Socket), because Kokoro's lexicon skips words it does not know."""
    text = re.sub(r"(?<=[a-z])(?=[A-Z])", " ", text)
    parts = [p for p in re.split(r"\s*(?:\.\.\.|…)\s*", text) if p.strip()]
    chunks, rate = [], 24000
    for i, part in enumerate(parts):
        audio = tts.generate(part, sid=sid, speed=speed)
        rate = audio.sample_rate
        if i > 0:
            chunks.append(np.zeros(int(0.7 * rate), dtype=np.float32))
        chunks.append(np.asarray(audio.samples, dtype=np.float32))
    if not chunks:
        return np.zeros(1, dtype=np.float32), rate
    return np.concatenate(chunks), rate


def write_wav(path: Path, samples: np.ndarray, rate: int) -> None:
    pcm = np.clip(samples, -1.0, 1.0)
    with wave.open(str(path), "wb") as w:
        w.setnchannels(1)
        w.setsampwidth(2)
        w.setframerate(rate)
        w.writeframes((pcm * 32767).astype("<i2").tobytes())
