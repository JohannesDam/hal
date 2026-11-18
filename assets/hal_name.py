"""HAL's name, as one guest says it: learned by /hal learn, matched by the ears.

Two signals, both learned from the guest's own voice and kept only on this machine
(%LOCALAPPDATA%\\hal\\name\\, deleted by /hal forget):

- spellings: how Whisper writes this guest's "HAL" ("Hal", "Hell", "Hello", ...). A transcript
  whose first word is one of them is addressed to HAL.
- prints: a small acoustic fingerprint (MFCC frames) of each recording, never the audio.
  A short segment that Whisper could not read is compared with them (dynamic time warping);
  the threshold is set from the guest's ordinary sentences, so that those do not match.
"""

import json
import re
from pathlib import Path

import numpy as np

RATE = 16000
FRAME = 400  # 25 ms
HOP = 160  # 10 ms
N_MELS = 40
N_MFCC = 13
# Only segments this short are compared by sound: a name said alone, not a sentence.
MAX_NAME_SEC = 1.6

# What Whisper writes for "HAL" before anything was learned. "al" only with a comma.
DEFAULT_SPELLINGS = ["hal", "hall", "hale", "howl", "hull", "hel", "hell"]
LEADERS = {"hey", "hee", "hé", "oké", "okay", "ok", "hoi"}
# Words that open ordinary sentences and must never become his name, whatever Whisper did.
NEVER = {"al", "haal", "hallo", "hello", "hi", "he", "hey", "hè", "hoi", "ja", "nee", "ok", "okay", "well", "wel", "all", "i"}


def _mel_filters() -> np.ndarray:
    def hz_to_mel(f):
        return 2595.0 * np.log10(1.0 + f / 700.0)

    def mel_to_hz(m):
        return 700.0 * (10 ** (m / 2595.0) - 1.0)

    n_fft = 512
    mels = np.linspace(hz_to_mel(60.0), hz_to_mel(7600.0), N_MELS + 2)
    bins = np.floor((n_fft + 1) * mel_to_hz(mels) / RATE).astype(int)
    fb = np.zeros((N_MELS, n_fft // 2 + 1), dtype=np.float32)
    for i in range(1, N_MELS + 1):
        lo, mid, hi = bins[i - 1], bins[i], bins[i + 1]
        for k in range(lo, mid):
            fb[i - 1, k] = (k - lo) / max(1, mid - lo)
        for k in range(mid, hi):
            fb[i - 1, k] = (hi - k) / max(1, hi - mid)
    return fb


_FB = _mel_filters()
_DCT = np.cos(np.pi / N_MELS * (np.arange(N_MELS)[None, :] + 0.5) * np.arange(N_MFCC)[:, None]).astype(np.float32)
_WINDOW = np.hamming(FRAME).astype(np.float32)


def features(samples: np.ndarray) -> np.ndarray:
    """MFCC frames of the voiced part, mean-normalised: (frames, 13). Empty when silent."""
    x = np.asarray(samples, dtype=np.float32).reshape(-1)
    if len(x) < FRAME:
        return np.zeros((0, N_MFCC), dtype=np.float32)
    x = np.append(x[0], x[1:] - 0.97 * x[:-1])
    n = 1 + (len(x) - FRAME) // HOP
    idx = np.arange(FRAME)[None, :] + HOP * np.arange(n)[:, None]
    frames = x[idx] * _WINDOW
    power = np.abs(np.fft.rfft(frames, 512)) ** 2
    energy = power.sum(axis=1)
    # Keep the voiced frames: within 30 dB of the loudest and 10 dB above the room's floor.
    floor = np.percentile(energy, 10)
    voiced = energy > max(energy.max() * 1e-3, floor * 10)
    if voiced.sum() < 5:
        return np.zeros((0, N_MFCC), dtype=np.float32)
    first, last = np.argmax(voiced), len(voiced) - np.argmax(voiced[::-1])
    # The room's floor is added to every band before the log: noise then flattens both sides alike.
    bands = power @ _FB.T
    bands_floor = np.percentile(bands, 10, axis=0) + 1e-8
    mel = np.log(bands[first:last] + bands_floor)
    # c0 (loudness) is dropped; mean and variance normalisation per recording.
    mfcc = (mel @ _DCT.T)[:, 1:]
    return ((mfcc - mfcc.mean(axis=0)) / (mfcc.std(axis=0) + 1e-3)).astype(np.float32)


def dtw(a: np.ndarray, b: np.ndarray) -> float:
    """Length-normalised DTW distance between two MFCC sequences (lower is closer)."""
    if len(a) == 0 or len(b) == 0:
        return float("inf")
    # A name said twice is never twice as long: a large length gap is no match.
    if max(len(a), len(b)) > 2.2 * min(len(a), len(b)):
        return float("inf")
    cost = np.sqrt(((a[:, None, :] - b[None, :, :]) ** 2).sum(axis=2))
    n, m = cost.shape
    acc = np.full((n + 1, m + 1), np.inf, dtype=np.float64)
    acc[0, 0] = 0.0
    for i in range(1, n + 1):
        row, prev, c = acc[i], acc[i - 1], cost[i - 1]
        for j in range(1, m + 1):
            row[j] = c[j - 1] + min(prev[j], row[j - 1], prev[j - 1])
    return float(acc[n, m] / (n + m))


def first_word(text: str) -> str:
    words = re.findall(r"[^\W\d_]+", text.lower())
    if words and words[0] in LEADERS and len(words) > 1:
        words = words[1:]
    return words[0] if words else ""


def rest_after_name(text: str) -> str:
    """The sentence after the name (and a 'hey' before it), capitalised; '' when nothing follows."""
    plain = text.strip()
    m = re.match(r"^(?:(?:hey|hee|hé|oké|okay|ok|hoi)[\s,]+)?[^\W\d_]+[\s,.:;!?-]*(.*)$", plain, re.I)
    rest = (m.group(1) if m else "").strip()
    if not re.search(r"[^\W\d_]", rest):
        return ""
    return rest[0].upper() + rest[1:]


class Name:
    """What this machine knows about how its guest says HAL."""

    def __init__(self, folder: Path) -> None:
        self.folder = folder
        self.spellings = set(DEFAULT_SPELLINGS)
        self.prints: list[np.ndarray] = []
        self.threshold = 0.0
        self.learned = {}
        self.load()

    @property
    def is_learned(self) -> bool:
        return bool(self.prints) and self.threshold > 0

    def load(self) -> None:
        try:
            meta = json.loads((self.folder / "name.json").read_text(encoding="utf-8"))
            data = np.load(self.folder / "prints.npz")
            self.prints = [data[k] for k in sorted(data.files)]
            self.threshold = float(meta["threshold"])
            self.spellings = set(DEFAULT_SPELLINGS) | set(meta.get("spellings", []))
            self.learned = meta
        except (OSError, ValueError, KeyError):
            self.prints, self.threshold, self.learned = [], 0.0, {}
            self.spellings = set(DEFAULT_SPELLINGS)

    def forget(self) -> None:
        for name in ("name.json", "prints.npz"):
            try:
                (self.folder / name).unlink()
            except OSError:
                pass
        self.load()

    def is_name_word(self, word: str) -> bool:
        return bool(word) and word not in NEVER and word in self.spellings

    def sounds_like(self, samples: np.ndarray) -> bool:
        if not self.is_learned or len(samples) > 3 * MAX_NAME_SEC * RATE:
            return False
        f = features(samples)  # the voiced part only
        if len(f) == 0 or len(f) * HOP > MAX_NAME_SEC * RATE:
            return False
        return min(dtw(f, p) for p in self.prints) <= self.threshold

    def hear(self, text: str, samples: np.ndarray, is_noise: bool) -> tuple[bool, str]:
        """(addressed to HAL, the rest of the sentence). Whisper first; the prints for short noise."""
        if not is_noise:
            word = first_word(text)
            if self.is_name_word(word):
                return True, rest_after_name(text)
            # A lone word that Whisper did not know as a name, said like the name.
            if len(re.findall(r"[^\W\d_]+", text)) <= 1 and self.sounds_like(samples):
                return True, ""
            return False, ""
        return (self.sounds_like(samples), "")

    def learn(self, names: list[tuple[np.ndarray, str]], others: list[np.ndarray]) -> dict:
        """From five recordings of the name (with Whisper's text) and a few ordinary sentences:
        the spellings, the prints and a threshold. Saves and returns what was learned."""
        prints = [features(s) for s, _ in names]
        prints = [p for p in prints if len(p) >= 8]
        spellings = sorted({w for _, t in names if (w := first_word(t)) and w not in NEVER})
        if len(prints) < 3:
            return {"ok": False, "why": "too few clear recordings", "kept": len(prints), "of": len(names)}
        # How close the name comes to itself: each print against the others.
        own = [min(dtw(p, q) for j, q in enumerate(prints) if j != i) for i, p in enumerate(prints)]
        # How close ordinary speech comes: windows of the sentences, about one name long.
        length = int(np.median([len(p) for p in prints]))
        windows = []
        for s in others:
            f_all = features(s)
            for start in range(0, max(1, len(f_all) - length + 1), 10):
                w = f_all[start : start + length]
                if len(w) >= 8:
                    windows.append(w - w.mean(axis=0))
        near_other = min((min(dtw(w, p) for p in prints) for w in windows), default=float("inf"))
        reach = float(np.percentile(own, 80))
        if near_other == float("inf"):
            threshold = reach * 1.15
        elif reach < near_other:
            threshold = reach + 0.5 * (near_other - reach)
        else:
            threshold = 0.95 * near_other
        caught = sum(1 for d in own if d <= threshold)
        meta = {
            "version": 1,
            "threshold": round(float(threshold), 4),
            "spellings": spellings,
            "caught": caught,
            "of": len(prints),
            "margin": round(float(near_other - reach), 4) if near_other != float("inf") else None,
            "ok": caught >= 3,
        }
        self.folder.mkdir(parents=True, exist_ok=True)
        np.savez_compressed(self.folder / "prints.npz", **{f"p{i}": p for i, p in enumerate(prints)})
        (self.folder / "name.json").write_text(json.dumps(meta, indent=1), encoding="utf-8")
        self.load()
        return meta
