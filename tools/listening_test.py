"""Blind listening test for HAL's voice.

Renders eight fixed lines with a few stock Kokoro voices, two blends of them, and the
processed Windows voice; runs every file through HAL's own voice chain
(assets/hal-host.ps1); and writes a page on which the voices are only letters. The key
stays in key.json next to it.

Setup (once): Kokoro multi-lang v1.0 extracted under %LOCALAPPDATA%\\hal\\models\\kokoro,
and a venv with `pip install sherpa-onnx numpy` at %LOCALAPPDATA%\\hal\\venv.

    %LOCALAPPDATA%\\hal\\venv\\Scripts\\python.exe -I tools\\listening_test.py --name Sam
"""

import argparse
import json
import os
import random
import shutil
import subprocess
import sys
from pathlib import Path

import numpy as np

ROOT = Path(__file__).resolve().parent.parent
sys.path.insert(0, str(ROOT / "assets"))

from hal_kokoro import MODEL, STYLE_DIM, STYLE_ROWS, VOICES, make_tts, say, write_wav  # noqa: E402

HAL = Path(os.environ["LOCALAPPDATA"]) / "hal"
OUT = HAL / "listening"
SPEED = 0.9

# Greeting, bad news, question, name, number, long sentence, technical term, a pause.
LINES = [
    "Good evening. Your session has started in my machine.",
    "The build failed. Line forty, the same as yesterday.",
    "Which test did you mean to run first?",
    "{name}, you left the parser open again.",
    "Three hundred and twelve files. Nineteen of them changed tonight.",
    "I watched the migration run for eleven minutes, and the only thing that changed was the order in which the tables were locked.",
    "The TypeScript compiler found two errors in the WebSocket handler.",
    "You stopped typing ... I noticed.",
]

CANDIDATES = [
    ("bm_george", [("bm_george", 1.0)]),
    ("bm_fable", [("bm_fable", 1.0)]),
    ("am_michael", [("am_michael", 1.0)]),
    ("am_fenrir", [("am_fenrir", 1.0)]),
    ("blend bm_george + am_michael", [("bm_george", 0.5), ("am_michael", 0.5)]),
    ("blend bm_fable + am_fenrir", [("bm_fable", 0.5), ("am_fenrir", 0.5)]),
    ("Windows George, processed", None),
]


def blended_voices(blends: list) -> tuple[Path, dict]:
    """A copy of voices.bin with each blend in the place of a voice we never use (the model
    insists on its own speaker count); returns the file and each blend's id."""
    styles = np.fromfile(MODEL / "voices.bin", dtype="<f4").reshape(-1, STYLE_ROWS, STYLE_DIM)
    if styles.shape[0] != len(VOICES):
        raise SystemExit(f"voices.bin holds {styles.shape[0]} voices, expected {len(VOICES)}")
    mixed, ids = styles.copy(), {}
    for i, (label, parts) in enumerate(blends):
        slot = len(VOICES) - 1 - i  # the last voices (Mandarin) are never used here
        mixed[slot] = sum(weight * styles[VOICES.index(name)] for name, weight in parts)
        ids[label] = slot
    path = OUT / "voices-with-blends.bin"
    mixed.astype("<f4").tofile(path)
    return path, ids


def host(*args: str) -> None:
    windows = os.environ.get("SystemRoot", r"C:\Windows")
    powershell = Path(windows) / "System32" / "WindowsPowerShell" / "v1.0" / "powershell.exe"
    subprocess.run(
        [str(powershell), "-NoProfile", "-STA", "-ExecutionPolicy", "Bypass", "-File", str(ROOT / "assets" / "hal-host.ps1"), *args],
        check=True,
    )


PAGE = """<!doctype html>
<html lang="en"><head><meta charset="utf-8"><title>HAL voice: blind test</title>
<style>
body {{ background:#0a0606; color:#cfc6c2; font:15px/1.5 system-ui, sans-serif; margin:32px; }}
h1 {{ font-weight:400; color:#e5301c; }} table {{ border-collapse:collapse; }}
td, th {{ padding:6px 10px; border-bottom:1px solid #2a1412; text-align:left; vertical-align:middle; }}
button {{ background:#1c0d0b; color:#eadbd6; border:1px solid #5a1a14; padding:4px 12px; cursor:pointer; }}
button.playing {{ background:#e5301c; color:#0a0606; }} .line {{ max-width:420px; }}
</style></head><body>
<h1>HAL voice, blind</h1>
<p>Each letter is one voice. Listen to every letter (the "all" button plays its eight lines),
on the headset and on the speakers. Criterion: calm, close, unmoved. A warm timbre is fine;
a friendly tone is a reason to reject. Then name your favourite letter, and any you reject.</p>
<table><tr><th>line</th>{heads}</tr>
<tr><td><em>all eight</em></td>{alls}</tr>
{rows}
</table>
<script>
let current = null;
function play(files, button) {{
  if (current) {{ current.audio.pause(); current.button.classList.remove('playing'); }}
  let i = 0; const audio = new Audio(); current = {{ audio, button }};
  button.classList.add('playing');
  const next = () => {{ if (i >= files.length) {{ button.classList.remove('playing'); return; }}
    audio.src = files[i++]; audio.play(); }};
  audio.onended = () => setTimeout(next, 600); next();
}}
</script></body></html>"""


def main() -> None:
    parser = argparse.ArgumentParser(description=__doc__.splitlines()[0])
    parser.add_argument("--name", default="Sam", help="the name used in the name line")
    parser.add_argument("--seed", type=int, default=None, help="fix the letters, for a repeat on another machine")
    args = parser.parse_args()

    if OUT.exists():
        shutil.rmtree(OUT)
    raw, processed = OUT / "raw", OUT / "processed"
    raw.mkdir(parents=True)
    processed.mkdir()

    lines = [line.replace("{name}", args.name) for line in LINES]
    order = list(range(len(CANDIDATES)))
    random.Random(args.seed).shuffle(order)
    letters = {CANDIDATES[c][0]: chr(ord("A") + i) for i, c in enumerate(order)}

    voices, blend_ids = blended_voices([c for c in CANDIDATES if c[1] and len(c[1]) > 1])
    tts = make_tts(voices)
    for label, parts in CANDIDATES:
        letter = letters[label]
        for n, text in enumerate(lines, 1):
            if parts is None:
                host("-RenderText", text, "-OutWav", str(processed / f"{letter}-{n}.wav"))
                continue
            sid = blend_ids[label] if len(parts) > 1 else VOICES.index(parts[0][0])
            samples, rate = say(tts, text, sid, SPEED)
            write_wav(raw / f"{letter}-{n}.wav", samples, rate)
        print(f"{letter} ready")
    host("-ProcessDir", str(raw), "-OutDir", str(processed))

    ordered = sorted(letters.values())
    heads = "".join(f"<th>{l}</th>" for l in ordered)
    alls = "".join(
        f"<td><button onclick='play({json.dumps([f'processed/{l}-{n}.wav' for n in range(1, len(lines) + 1)])}, this)'>all</button></td>"
        for l in ordered
    )
    rows = "\n".join(
        f"<tr><td class='line'>{n}. {text}</td>"
        + "".join(f"<td><button onclick='play([\"processed/{l}-{n}.wav\"], this)'>{l}</button></td>" for l in ordered)
        + "</tr>"
        for n, text in enumerate(lines, 1)
    )
    (OUT / "listening.html").write_text(PAGE.format(heads=heads, alls=alls, rows=rows), encoding="utf-8")
    (OUT / "key.json").write_text(json.dumps({v: k for k, v in letters.items()}, indent=2), encoding="utf-8")
    shutil.rmtree(raw)
    print(OUT / "listening.html")


if __name__ == "__main__":
    main()
