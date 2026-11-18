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
NEVER = {
    "al", "haal", "hallo", "hello", "hi", "he", "hey", "hè", "hoi", "ja", "nee", "ok", "okay", "well", "wel", "all", "i",
    "oh", "go", "how", "who", "hoe", "hè", "her", "his", "has", "had", "hot", "hat", "hit", "help", "half", "halt",
}
# A learned spelling must sound like his name: at most one letter away from one of these.
NAME_SHAPES = ["hal", "hall", "hell", "hale", "hull", "howl", "haul", "hol"]


def _distance(a: str, b: str) -> int:
    row = list(range(len(b) + 1))
    for i, ca in enumerate(a, 1):
        prev, row[0] = row[0], i
        for j, cb in enumerate(b, 1):
            prev, row[j] = row[j], min(row[j] + 1, row[j - 1] + 1, prev + (ca != cb))
    return row[-1]


# The word that ends a conversation, said alone: "stop" as Whisper may write it.
STOP_SHAPES = ["stop", "stopp", "stoppen", "stap", "stob"]


def is_stop_word(text: str) -> bool:
    words = re.findall(r"[^\W\d_]+", re.sub(r"\[[^\]]*\]|\([^)]*\)", " ", text.lower()))
    return len(words) == 1 and any(_distance(words[0], shape) <= 1 for shape in STOP_SHAPES) and words[0] not in {"top", "shop", "step"}


def is_name_shaped(word: str) -> bool:
    return word not in NEVER and any(_distance(word, shape) <= 1 for shape in NAME_SHAPES)


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
    # Whisper's own markers ("[BLANK_AUDIO]", "(music)") are not words anyone said.
    text = re.sub(r"\[[^\]]*\]|\([^)]*\)|\*[^*]*\*", " ", text)
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
        self.stop_prints: list[np.ndarray] = []
        self.stop_threshold = 0.0
        self.learned = {}
        self.load()

    @property
    def is_learned(self) -> bool:
        return bool(self.learned.get("ok"))

    def load(self) -> None:
        try:
            meta = json.loads((self.folder / "name.json").read_text(encoding="utf-8"))
            data = np.load(self.folder / "prints.npz")
            self.prints = [data[k] for k in sorted(data.files) if k.startswith("p")]
            self.stop_prints = [data[k] for k in sorted(data.files) if k.startswith("s")]
            self.threshold = float(meta["threshold"])
            self.stop_threshold = float(meta.get("stop_threshold", 0.0))
            # Files from version 1 could hold any word ("oh", "go"): only name-shaped ones count.
            self.spellings = set(DEFAULT_SPELLINGS) | {w for w in meta.get("spellings", []) if is_name_shaped(w)}
            if meta.get("version", 1) < 2 and (meta.get("margin") or 0) <= 0:
                self.threshold = 0.0
                meta = {**meta, "ok": False}
            self.learned = meta
        except (OSError, ValueError, KeyError):
            self.prints, self.threshold, self.learned = [], 0.0, {}
            self.stop_prints, self.stop_threshold = [], 0.0
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
        if not self.prints or self.threshold <= 0 or len(samples) > 3 * MAX_NAME_SEC * RATE:
            return False
        f = features(samples)  # the voiced part only
        if len(f) == 0 or len(f) * HOP > MAX_NAME_SEC * RATE:
            return False
        return min(dtw(f, p) for p in self.prints) <= self.threshold

    def is_stop(self, text: str, samples: np.ndarray, is_noise: bool) -> bool:
        """'stop', alone: the word that ends a conversation. Whisper first; the prints for noise."""
        if not is_noise and is_stop_word(text):
            return True
        if not self.stop_prints or self.stop_threshold <= 0 or (not is_noise and len(re.findall(r"[^\W\d_]+", text)) > 1):
            return False
        f = features(samples)
        if len(f) == 0 or len(f) * HOP > MAX_NAME_SEC * RATE:
            return False
        return min(dtw(f, p) for p in self.stop_prints) <= self.stop_threshold

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

    def learn(
        self,
        names: list[tuple[np.ndarray, str]],
        others: list[np.ndarray],
        stops: list[tuple[np.ndarray, str]] | None = None,
    ) -> dict:
        stops = stops or []
        """From five recordings of the name (with Whisper's text) and a few ordinary sentences:
        the spellings, the prints and a threshold. Saves and returns what was learned."""
        # Spellings: only words shaped like his name, written so at least twice.
        words = [first_word(t) for _, t in names]
        spellings = sorted({w for w in words if is_name_shaped(w) and words.count(w) >= 2})
        known = set(DEFAULT_SPELLINGS) | set(spellings)
        by_spelling = [w in known and w not in NEVER for w in words]
        clear = [(features(s), i) for i, (s, _) in enumerate(names)]
        clear = [(p, i) for p, i in clear if len(p) >= 8]
        prints = [p for p, _ in clear]
        threshold, margin, by_sound = 0.0, None, [False] * len(names)
        if len(prints) >= 3:
            # How close the name comes to itself: each print against the others.
            own = [min(dtw(p, q) for j, q in enumerate(prints) if j != k) for k, p in enumerate(prints)]
            # How close ordinary speech comes: windows of the sentences, about one name long,
            # normalised exactly as the prints are.
            length = int(np.median([len(p) for p in prints]))
            windows = []
            for s in others:
                f_all = features(s)
                for start in range(0, max(1, len(f_all) - length + 1), 10):
                    w = f_all[start : start + length]
                    if len(w) >= 8:
                        windows.append((w - w.mean(axis=0)) / (w.std(axis=0) + 1e-3))
            near_other = min((min(dtw(w, p) for p in prints) for w in windows), default=float("inf"))
            reach = float(np.percentile(own, 80))
            if near_other == float("inf"):
                threshold = reach * 1.15
            elif reach < near_other:
                margin = near_other - reach
                threshold = reach + 0.5 * margin
            else:
                # His name and the guest's ordinary words sound alike: the prints would fire on
                # ordinary speech. They are not used; only the spellings count.
                margin = near_other - reach
                threshold = 0.0
            if threshold > 0:
                for (_, i), d in zip(clear, own):
                    by_sound[i] = d <= threshold
        caught = sum(1 for a, b in zip(by_spelling, by_sound) if a or b)
        meta = {
            "version": 2,
            "threshold": round(float(threshold), 4),
            "sound": threshold > 0,
            "spellings": spellings,
            "caught": caught,
            "of": len(names),
            "margin": round(float(margin), 4) if margin is not None else None,
            "ok": caught >= 3,
        }
        if not meta["ok"]:
            meta["why"] = (
                "his name and your other words sound too alike to me"
                if margin is not None and margin <= 0
                else "speech recognition did not write your HAL as his name"
            )
        # "stop": its own prints, kept apart from his name and from the ordinary sentences.
        stop_prints = [p for p in (features(s) for s, _ in stops) if len(p) >= 6]
        stop_threshold = 0.0
        by_stop_word = [is_stop_word(t) for _, t in stops]
        by_stop_sound = [False] * len(stop_prints)
        if len(stop_prints) >= 2:
            own_stop = [min(dtw(p, q) for j, q in enumerate(stop_prints) if j != k) for k, p in enumerate(stop_prints)]
            length = int(np.median([len(p) for p in stop_prints]))
            negatives = list(prints)
            for s in others:
                f_all = features(s)
                for start in range(0, max(1, len(f_all) - length + 1), 10):
                    w = f_all[start : start + length]
                    if len(w) >= 6:
                        negatives.append((w - w.mean(axis=0)) / (w.std(axis=0) + 1e-3))
            near = min((min(dtw(n, p) for p in stop_prints) for n in negatives), default=float("inf"))
            reach_stop = float(max(own_stop))
            if near == float("inf"):
                stop_threshold = reach_stop * 1.15
            elif reach_stop < near:
                stop_threshold = reach_stop + 0.5 * (near - reach_stop)
            by_stop_sound = [d <= stop_threshold for d in own_stop] if stop_threshold > 0 else by_stop_sound
        meta["stop_threshold"] = round(float(stop_threshold), 4)
        meta["stop_caught"] = sum(1 for i in range(len(stops)) if by_stop_word[i] or (i < len(by_stop_sound) and by_stop_sound[i]))
        meta["stop_of"] = len(stops)
        self.folder.mkdir(parents=True, exist_ok=True)
        np.savez_compressed(
            self.folder / "prints.npz",
            **{f"p{i}": p for i, p in enumerate(prints)},
            **{f"s{i}": p for i, p in enumerate(stop_prints)},
        )
        (self.folder / "name.json").write_text(json.dumps(meta, indent=1), encoding="utf-8")
        self.load()
        return meta
