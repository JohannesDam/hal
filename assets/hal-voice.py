"""HAL's Kokoro voice, kept warm by HAL's process (hal-host.ps1).

    python hal-voice.py <voice> <speed>

One JSON request per line on stdin: {"id": "...", "text": "..."}.
One JSON answer per line on stdout: {"t": "ready"}, then {"t": "done", "id", "path"} with
a 16-bit wav, or {"t": "error", "id", "why"}. Nothing leaves the machine.
"""

import json
import sys
import tempfile
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent))

from hal_kokoro import VOICES, make_tts, say, write_wav  # noqa: E402


def answer(message: dict) -> None:
    sys.stdout.write(json.dumps(message, ensure_ascii=True) + "\n")
    sys.stdout.flush()


def main() -> None:
    voice = sys.argv[1] if len(sys.argv) > 1 else "am_michael"
    speed = float(sys.argv[2]) if len(sys.argv) > 2 else 0.9
    if voice not in VOICES:
        answer({"t": "error", "id": "", "why": f"unknown voice {voice}"})
        return
    tts = make_tts()
    sid = VOICES.index(voice)
    out = Path(tempfile.gettempdir()) / "hal-voice"
    out.mkdir(exist_ok=True)
    for old in out.glob("*.wav"):
        old.unlink(missing_ok=True)
    answer({"t": "ready", "voice": voice, "speed": speed})

    for line in sys.stdin:
        line = line.strip()
        if not line:
            continue
        request = json.loads(line)
        rid = str(request.get("id", ""))
        try:
            samples, rate = say(tts, str(request.get("text", "")), sid, speed)
            path = out / f"{''.join(c for c in rid if c.isalnum() or c in '-_') or 'line'}.wav"
            write_wav(path, samples, rate)
            answer({"t": "done", "id": rid, "path": str(path)})
        except Exception as error:  # an answer for every request, whatever happens
            answer({"t": "error", "id": rid, "why": str(error)})


if __name__ == "__main__":
    main()
