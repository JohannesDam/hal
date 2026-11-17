"""HAL's neural voice, kept warm by HAL's process (hal-host.ps1).

    python hal-voice.py <voice> [<speed>]

<voice> is a Piper voice set up in %LOCALAPPDATA%\\hal\\models\\piper (kestrin, the default)
or a Kokoro voice (am_michael). A speed of 0 or none takes the engine's own default.
One JSON request per line on stdin: {"id": "...", "text": "..."}.
One JSON answer per line on stdout: {"t": "ready"}, then {"t": "done", "id", "path"} with
a 16-bit wav, or {"t": "error", "id", "why"}. Nothing leaves the machine.
"""

import io
import json
import sys
import tempfile
import wave
from pathlib import Path

import numpy as np

sys.path.insert(0, str(Path(__file__).resolve().parent))

# The speed each engine sounded right at in a listening test.
DEFAULT_SPEED = {"piper": 1.0, "kokoro": 0.9}


def answer(message: dict) -> None:
    sys.stdout.write(json.dumps(message, ensure_ascii=True) + "\n")
    sys.stdout.flush()


def write_wav(path: Path, samples: np.ndarray, rate: int) -> None:
    pcm = np.clip(samples, -1.0, 1.0)
    with wave.open(str(path), "wb") as w:
        w.setnchannels(1)
        w.setsampwidth(2)
        w.setframerate(rate)
        w.writeframes((pcm * 32767).astype("<i2").tobytes())


def load(voice: str, speed: float):
    """(engine, speed, speak) with speak(text) -> (samples, rate); raises for an unknown voice.
    Each engine is imported only when it is used, so a machine needs only its own."""
    import hal_piper

    if hal_piper.is_set_up(voice):
        model = hal_piper.make_voice(voice)
        speed = speed or DEFAULT_SPEED["piper"]
        return "piper", speed, lambda text: hal_piper.say(model, text, speed)

    import hal_kokoro

    if voice in hal_kokoro.VOICES:
        tts = hal_kokoro.make_tts()
        sid = hal_kokoro.VOICES.index(voice)
        speed = speed or DEFAULT_SPEED["kokoro"]
        return "kokoro", speed, lambda text: hal_kokoro.say(tts, text, sid, speed)

    raise ValueError(f"voice {voice} is not set up")


def main() -> None:
    voice = sys.argv[1] if len(sys.argv) > 1 else "kestrin"
    speed = float(sys.argv[2]) if len(sys.argv) > 2 else 0.0
    try:
        engine, speed, speak = load(voice, speed)
    except Exception as error:
        answer({"t": "error", "id": "", "why": str(error)})
        return
    out = Path(tempfile.gettempdir()) / "hal-voice"
    out.mkdir(exist_ok=True)
    for old in out.glob("*.wav"):
        old.unlink(missing_ok=True)
    answer({"t": "ready", "voice": voice, "engine": engine, "speed": speed})

    # The host's .NET writer may start with a UTF-8 BOM (when the console's input encoding is
    # UTF-8); utf-8-sig drops it, where the default pipe encoding would choke on the first line.
    for line in io.TextIOWrapper(sys.stdin.buffer, encoding="utf-8-sig"):
        line = line.strip()
        if not line:
            continue
        request = json.loads(line)
        rid = str(request.get("id", ""))
        try:
            samples, rate = speak(str(request.get("text", "")))
            path = out / f"{''.join(c for c in rid if c.isalnum() or c in '-_') or 'line'}.wav"
            write_wav(path, samples, rate)
            answer({"t": "done", "id": rid, "path": str(path)})
        except Exception as error:  # an answer for every request, whatever happens
            answer({"t": "error", "id": rid, "why": str(error)})


if __name__ == "__main__":
    main()
