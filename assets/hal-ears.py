"""HAL's ears, started and fed by HAL's process (hal-host.ps1).

    python hal-ears.py [--mic <part of a name>] [--model small|base] [--list]

Two inputs, both local: a microphone and the loopback of the default output (what the
computer plays). Silero VAD cuts speech out of each, multilingual Whisper (sherpa-onnx)
writes it down. Nothing is written to disk; the words exist only in the lines below.

stdin, one JSON object per line, from the host:
  {"gate": true|false}   HAL speaks / is done (300 ms tail after false)
  {"override": true}     keep listening while another app holds the microphone, for that call
  {"learn": "name"|"stop"|"other"|"finish"|"cancel"|"forget"}   /hal learn (hal_name.py)
stdout, one JSON object per line:
  {"t": "ears", "state": "listening"|"deaf", "why", "app", "mic", "loop", "learned"}
  {"t": "speech", "src": "mic"|"loop", "on": true|false}
  {"t": "heard", "src", "text", "lang", "sec"}
  {"t": "heard", "src": "mic", "name": true, "text": <the rest, or "">, "sec"}  addressed to HAL
  {"t": "heard", "src": "mic", "stop": true, "text": ""}   "stop", alone: the conversation ends
  {"t": "learn", "step": "name"|"stop"|"other", "got": n}
  {"t": "learned", "ok", "caught", "of", "spellings", ...} or {"t": "learned", "forgotten": true}
  {"t": "error", "why"}
"""

import json
import os
import queue
import re
import sys
import threading
import time
import warnings
import winreg
from pathlib import Path

import numpy as np

from hal_name import Name

RATE = 16000
BLOCK = 1600  # 100 ms
MODELS = Path(os.environ.get("LOCALAPPDATA", ".")) / "hal" / "models"

# Microphones that are no microphone: virtual devices of streaming and routing tools.
VIRTUAL = re.compile(r"streaming audio|virtual|stereo mix|vb-audio|cable output|voicemeeter|steam", re.I)
BUILT_IN = re.compile(r"microphone array|internal|built-in|ingebouwd|interne", re.I)

# What Whisper writes for silence, music or noise.
HALLUCINATIONS = re.compile(
    r"^(thank you|thanks)( so much)? for watching|^subtitles? by|amara\.org|^ondertitel|"
    r"^bedankt voor het (kijken|luisteren)|^you\.?$|^\.+$|^\[.*\]$|^\(.*\)$",
    re.I,
)

LANGUAGES = {"en", "nl"}  # decision 6: Dutch and English; anything else is noise read as speech

_out = threading.Lock()


def is_noise(text: str, lang: str) -> bool:
    """Whisper writes something for every segment: noise comes back as phonetic signs,
    brackets, a stray language or a stock phrase."""
    if lang and lang not in LANGUAGES:
        return True
    letters = sum(c.isascii() and c.isalpha() for c in text)
    return letters < 2 or letters < 0.6 * len(text.replace(" ", "")) or bool(HALLUCINATIONS.search(text))


def emit(message: dict) -> None:
    with _out:
        sys.stdout.write(json.dumps(message, ensure_ascii=True) + "\n")
        sys.stdout.flush()


class Gate:
    """Closed while HAL speaks and 300 ms after; deaf while another app holds the mic."""

    def __init__(self) -> None:
        self.is_speaking = False
        self.open_at = 0.0
        self.is_override = False
        self.call_app = ""

    def is_closed(self) -> bool:
        return self.is_speaking or time.monotonic() < self.open_at

    def set_speaking(self, on: bool) -> None:
        self.is_speaking = on
        if not on:
            self.open_at = time.monotonic() + 0.3

    def is_deaf(self) -> bool:
        return bool(self.call_app) and not self.is_override


def pick_mic(sc, wish: str):
    mics = [m for m in sc.all_microphones(include_loopback=False)]
    if wish:
        for m in mics:
            if wish.lower() in m.name.lower():
                return m
    for m in mics:
        if BUILT_IN.search(m.name) and not VIRTUAL.search(m.name):
            return m
    default = sc.default_microphone()
    if default is not None and not VIRTUAL.search(default.name):
        return default
    real = [m for m in mics if not VIRTUAL.search(m.name)]
    return real[0] if real else None


def pick_loop(sc):
    speaker = sc.default_speaker()
    if speaker is None:
        return None
    return sc.get_microphone(speaker.id, include_loopback=True)


def own_executables() -> set[str]:
    names = {sys.executable, getattr(sys, "_base_executable", sys.executable)}
    return {str(Path(n).resolve()).lower().replace("\\", "#") for n in names if n}


def mic_users(own: set[str]) -> list[str]:
    """Apps that hold a microphone right now, from the store behind Windows' mic indicator."""
    base = r"Software\Microsoft\Windows\CurrentVersion\CapabilityAccessManager\ConsentStore\microphone"
    users = []

    def scan(path: str, is_packaged: bool) -> None:
        try:
            key = winreg.OpenKey(winreg.HKEY_CURRENT_USER, path)
        except OSError:
            return
        with key:
            i = 0
            while True:
                try:
                    name = winreg.EnumKey(key, i)
                except OSError:
                    break
                i += 1
                if name == "NonPackaged":
                    continue
                try:
                    with winreg.OpenKey(key, name) as app:
                        start = winreg.QueryValueEx(app, "LastUsedTimeStart")[0]
                        stop = winreg.QueryValueEx(app, "LastUsedTimeStop")[0]
                except OSError:
                    continue
                if start and stop == 0 and name.lower() not in own:
                    # Packaged: Publisher.App_hash. Not packaged: the exe's path with # for \.
                    users.append(name.split("_")[0] if is_packaged else name.split("#")[-1])

    scan(base, True)
    scan(base + r"\NonPackaged", False)
    return users


class Source(threading.Thread):
    """One input: records 100 ms blocks, cuts speech with its own VAD, queues segments."""

    def __init__(self, kind: str, ears: "Ears") -> None:
        super().__init__(daemon=True)
        self.kind = kind
        self.ears = ears
        self.device_name = ""
        self.is_speech = False

    def make_vad(self):
        import sherpa_onnx

        config = sherpa_onnx.VadModelConfig()
        config.silero_vad.model = str(MODELS / "vad" / "silero_vad.onnx")
        config.silero_vad.threshold = 0.5
        config.silero_vad.min_silence_duration = 0.6
        config.silero_vad.min_speech_duration = 0.3
        config.silero_vad.max_speech_duration = 20
        config.sample_rate = RATE
        return sherpa_onnx.VoiceActivityDetector(config, buffer_size_in_seconds=60)

    def set_speech(self, on: bool) -> None:
        if on != self.is_speech:
            self.is_speech = on
            emit({"t": "speech", "src": self.kind, "on": on})

    def run(self) -> None:
        import soundcard as sc

        vad = self.make_vad()
        while True:
            if self.ears.gate.is_deaf():
                self.device_name = ""
                time.sleep(0.5)
                continue
            try:
                device = pick_mic(sc, self.ears.wish) if self.kind == "mic" else pick_loop(sc)
            except Exception as error:
                device = None
                emit({"t": "error", "why": f"{self.kind}: {error}"})
            if device is None:
                self.device_name = ""
                time.sleep(2)
                continue
            self.device_name = device.name
            self.ears.report()
            try:
                self.listen(device, vad)
            except Exception as error:
                emit({"t": "error", "why": f"{self.kind} {device.name}: {error}"})
                time.sleep(1)
            self.set_speech(False)
            vad.reset()

    def listen(self, device, vad) -> None:
        """Until the device goes, the default output changes, or HAL must go deaf."""
        import soundcard as sc

        checked = time.monotonic()
        with device.recorder(samplerate=RATE, channels=1, blocksize=BLOCK) as recorder:
            while not self.ears.gate.is_deaf():
                block = recorder.record(numframes=BLOCK)
                samples = np.asarray(block, dtype=np.float32).reshape(-1)
                if self.ears.gate.is_closed():
                    if self.is_speech or not vad.empty():
                        vad.reset()
                        self.set_speech(False)
                    continue
                vad.accept_waveform(samples)
                self.set_speech(vad.is_speech_detected())
                while not vad.empty():
                    segment = np.array(vad.front.samples, dtype=np.float32)
                    vad.pop()
                    self.ears.hear(self.kind, segment)
                if self.kind == "loop" and time.monotonic() - checked > 3:
                    checked = time.monotonic()
                    speaker = sc.default_speaker()
                    if speaker is None or speaker.id != device.id:
                        return


class Ears:
    def __init__(self, wish: str, model: str) -> None:
        self.wish = wish
        self.model = model
        self.gate = Gate()
        self.segments: queue.Queue = queue.Queue()
        self.sources = [Source("mic", self), Source("loop", self)]
        self.reported = ""
        self.name = Name(MODELS.parent / "name")
        # /hal learn: {"step": "name"|"other", "names": [(samples, text)], "others": [samples]}
        self.learning: dict | None = None

    def report(self) -> None:
        state = {
            "t": "ears",
            "state": "deaf" if self.gate.is_deaf() else "listening",
            "why": "call" if self.gate.is_deaf() else "",
            "app": self.gate.call_app,
            "mic": self.sources[0].device_name,
            "loop": self.sources[1].device_name,
            "learned": self.name.is_learned,
        }
        text = json.dumps(state, sort_keys=True)
        if text != self.reported:
            self.reported = text
            emit(state)

    def hear(self, kind: str, segment: np.ndarray) -> None:
        # Computer audio can flood: a backlog drops loopback first, never the microphone.
        if kind == "loop" and self.segments.qsize() > 3:
            return
        self.segments.put((kind, segment))

    def recognize(self) -> None:
        import sherpa_onnx

        d = MODELS / f"whisper-{self.model}"
        recognizer = sherpa_onnx.OfflineRecognizer.from_whisper(
            encoder=str(d / f"{self.model}-encoder.int8.onnx"),
            decoder=str(d / f"{self.model}-decoder.int8.onnx"),
            tokens=str(d / f"{self.model}-tokens.txt"),
            language="",
            task="transcribe",
            num_threads=4,
        )
        emit({"t": "ready", "model": self.model})
        for source in self.sources:
            source.start()
        while True:
            kind, segment = self.segments.get()
            if self.gate.is_deaf():
                continue
            stream = recognizer.create_stream()
            stream.accept_waveform(RATE, segment)
            recognizer.decode_stream(stream)
            text = stream.result.text.strip()
            lang = getattr(stream.result, "lang", "")
            noise = is_noise(text, lang)
            sec = round(len(segment) / RATE, 1)
            if kind == "mic" and self.learning is not None:
                self.learn_segment(segment, "" if noise else text)
                continue
            if kind == "mic" and self.name.is_stop(text, segment, noise):
                emit({"t": "heard", "src": kind, "stop": True, "text": "", "lang": lang, "sec": sec})
                continue
            if kind == "mic":
                named, rest = self.name.hear(text, segment, noise)
                if named:
                    emit({"t": "heard", "src": kind, "name": True, "text": rest, "lang": lang, "sec": sec})
                    continue
            if noise:
                continue
            emit({"t": "heard", "src": kind, "text": text, "lang": lang, "sec": sec})

    def learn_segment(self, segment: np.ndarray, text: str) -> None:
        """/hal learn: the name five times, then ordinary sentences. Nothing is sent as heard."""
        learning = self.learning
        if learning is None:
            return
        sec = len(segment) / RATE
        if learning["step"] == "name":
            if sec > 2.5:  # a sentence, not a name: ignored
                return
            learning["names"].append((segment, text))
            emit({"t": "learn", "step": "name", "got": len(learning["names"])})
        elif learning["step"] == "stop":
            if sec > 2.5:
                return
            learning["stops"].append((segment, text))
            emit({"t": "learn", "step": "stop", "got": len(learning["stops"])})
        elif learning["step"] == "other":
            if sec < 1.0:
                return
            learning["others"].append(segment)
            emit({"t": "learn", "step": "other", "got": len(learning["others"])})

    def on_learn(self, step: str) -> None:
        if step == "name":
            self.learning = {"step": "name", "names": [], "stops": [], "others": []}
        elif step in ("stop", "other") and self.learning is not None:
            self.learning["step"] = step
        elif step == "finish" and self.learning is not None:
            learning, self.learning = self.learning, None
            try:
                result = self.name.learn(learning["names"], learning["others"], learning["stops"])
            except Exception as error:  # never leave the wizard hanging
                result = {"ok": False, "why": str(error)}
            emit({"t": "learned", **result})
            self.reported = ""
            self.report()
        elif step == "cancel":
            self.learning = None
        elif step == "forget":
            self.learning = None
            self.name.forget()
            emit({"t": "learned", "forgotten": True})
            self.reported = ""
            self.report()

    def guard(self) -> None:
        """Deaf while another app holds the microphone (a call), unless overridden for it."""
        own = own_executables()
        while True:
            users = mic_users(own)
            app = users[0] if users else ""
            if not app:
                self.gate.is_override = False
            self.gate.call_app = app
            self.report()
            time.sleep(2)

    def commands(self) -> None:
        for line in sys.stdin.buffer:
            try:
                message = json.loads(line.decode("utf-8-sig"))
            except ValueError:
                continue
            if "gate" in message:
                self.gate.set_speaking(bool(message["gate"]))
            if message.get("override"):
                self.gate.is_override = True
                self.report()
            if isinstance(message.get("learn"), str):
                self.on_learn(message["learn"])
        os._exit(0)  # the host closed our stdin: it is gone, so are we


def main() -> None:
    import soundcard  # noqa: F401  its import sets its warnings to "always": override after it

    warnings.filterwarnings("ignore")  # soundcard warns on every discontinuity
    args = sys.argv[1:]
    wish = args[args.index("--mic") + 1] if "--mic" in args else ""
    model = args[args.index("--model") + 1] if "--model" in args else "small"
    if "--list" in args:
        import soundcard as sc

        for m in sc.all_microphones(include_loopback=True):
            print(("loop " if m.isloopback else "mic  ") + m.name)
        print("picked mic:", (pick_mic(sc, wish) or type("n", (), {"name": "none"})).name)
        return
    ears = Ears(wish, model)
    threading.Thread(target=ears.commands, daemon=True).start()
    threading.Thread(target=ears.guard, daemon=True).start()
    try:
        ears.recognize()
    except Exception as error:
        emit({"t": "error", "why": str(error)})


if __name__ == "__main__":
    main()
