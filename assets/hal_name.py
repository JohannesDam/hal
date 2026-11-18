"""How this guest calls HAL: learned by /hal learn, matched by the ears.

What works on a laptop microphone is a whole sentence, not his name alone: speech recognition
hears "Hell, please wake up." and the sentence decides, however the name comes out.

- "HAL, please wake up" opens a conversation; "HAL, go to sleep" (or "stop" alone) ends it.
  Both count only as short utterances of their own. /hal learn keeps how Whisper wrote this
  guest's two sentences, so a near miss ("Home, please wait up.") still counts.
- "HAL, what time is it" in one breath is a command: the first word must look like his name.

Only the transcripts of those two sentences are kept, on this machine
(%LOCALAPPDATA%\\hal\\name\\name.json), and /hal forget deletes them. Never the audio.
"""

import json
import re
from difflib import SequenceMatcher
from pathlib import Path

# What Whisper writes for "HAL" at the start of a sentence.
DEFAULT_SPELLINGS = ["hal", "hall", "hale", "howl", "hull", "hel", "hell"]
LEADERS = {"hey", "hee", "hé", "oké", "okay", "ok", "hoi"}
# Words that open ordinary sentences and must never become his name, whatever Whisper did.
NEVER = {
    "al", "haal", "hallo", "hello", "hi", "he", "hey", "hè", "hoi", "ja", "nee", "ok", "okay", "well", "wel",
    "all", "i", "oh", "go", "how", "who", "hoe", "her", "his", "has", "had", "hot", "hat", "hit", "help",
    "half", "halt",
}
# A learned spelling must sound like his name: at most one letter away from one of these.
NAME_SHAPES = ["hal", "hall", "hell", "hale", "hull", "howl", "haul", "hol"]
# "stop" as Whisper may write it, said alone.
STOP_SHAPES = ["stop", "stopp", "stoppen", "stap", "stob"]
NOT_STOP = {"top", "shop", "step"}
# The sentences, however the name comes out. Short utterances only.
WAKE_RE = re.compile(r"\bwake\s*up\b|\bwakker\b", re.I)
# "Oh, ga te sleepen." and "Oh, God sleep." are how one Dutch voice came out of "HAL, go to sleep".
SLEEP_RE = re.compile(r"\bgo[dt]?\s+(?:t[oe]\s+)?sleep\b|\bsleep now\b|\bga (?:te |maar )?sl(?:a|ee)pen\b", re.I)
MAX_PHRASE_WORDS = 7
# How close a later sentence must be to one the guest taught him (difflib ratio).
LIKE = 0.75


def _distance(a: str, b: str) -> int:
    row = list(range(len(b) + 1))
    for i, ca in enumerate(a, 1):
        prev, row[0] = row[0], i
        for j, cb in enumerate(b, 1):
            prev, row[j] = row[j], min(row[j] + 1, row[j - 1] + 1, prev + (ca != cb))
    return row[-1]


def words(text: str) -> list[str]:
    """Lower-case words, Whisper's own markers ("[BLANK_AUDIO]", "(music)") removed."""
    return re.findall(r"[^\W\d_]+", re.sub(r"\[[^\]]*\]|\([^)]*\)|\*[^*]*\*", " ", text.lower()))


def norm(text: str) -> str:
    return " ".join(words(text))


def is_name_shaped(word: str) -> bool:
    return word not in NEVER and any(_distance(word, shape) <= 1 for shape in NAME_SHAPES)


def is_stop_word(text: str) -> bool:
    ws = words(text)
    return len(ws) == 1 and ws[0] not in NOT_STOP and any(_distance(ws[0], shape) <= 1 for shape in STOP_SHAPES)


def like_learned(text: str, learned: list[str]) -> bool:
    """Close to one of the guest's own sentences, as Whisper wrote them during /hal learn."""
    n = norm(text)
    if not n or len(n.split()) > MAX_PHRASE_WORDS:
        return False
    return any(SequenceMatcher(None, n, sentence).ratio() >= LIKE for sentence in learned)


def first_word(text: str) -> str:
    ws = words(text)
    if ws and ws[0] in LEADERS and len(ws) > 1:
        ws = ws[1:]
    return ws[0] if ws else ""


def rest_after_name(text: str) -> str:
    """The sentence after the name (and a 'hey' before it), capitalised; '' when nothing follows."""
    m = re.match(r"^(?:(?:hey|hee|hé|oké|okay|ok|hoi)[\s,]+)?[^\W\d_]+[\s,.:;!?-]*(.*)$", text.strip(), re.I)
    rest = (m.group(1) if m else "").strip()
    if not re.search(r"[^\W\d_]", rest):
        return ""
    return rest[0].upper() + rest[1:]


class Name:
    """What this machine knows about how its guest calls HAL."""

    def __init__(self, folder: Path) -> None:
        self.folder = folder
        self.load()

    def load(self) -> None:
        self.spellings = set(DEFAULT_SPELLINGS)
        self.wake_texts: list[str] = []
        self.sleep_texts: list[str] = []
        self.learned: dict = {}
        try:
            meta = json.loads((self.folder / "name.json").read_text(encoding="utf-8"))
        except (OSError, ValueError):
            return
        # Earlier versions kept odd spellings ("oh", "go") and sound prints: only what is
        # shaped like his name, and the sentences, are read.
        self.spellings |= {w for w in meta.get("spellings", []) if isinstance(w, str) and is_name_shaped(w)}
        self.wake_texts = [t for t in meta.get("wake_texts", []) if isinstance(t, str) and t]
        self.sleep_texts = [t for t in meta.get("sleep_texts", []) if isinstance(t, str) and t]
        self.learned = meta if self.wake_texts else {}

    @property
    def is_learned(self) -> bool:
        return bool(self.learned.get("ok"))

    def forget(self) -> None:
        for name in ("name.json", "prints.npz"):  # prints.npz: left by versions before 0.6
            try:
                (self.folder / name).unlink()
            except OSError:
                pass
        self.load()

    def is_wake(self, text: str) -> bool:
        n = norm(text)
        return 0 < len(n.split()) <= MAX_PHRASE_WORDS and (bool(WAKE_RE.search(n)) or like_learned(n, self.wake_texts))

    def is_stop(self, text: str) -> bool:
        """'stop' alone, or 'HAL, go to sleep': the conversation ends."""
        if is_stop_word(text):
            return True
        n = norm(text)
        return 0 < len(n.split()) <= MAX_PHRASE_WORDS and (bool(SLEEP_RE.search(n)) or like_learned(n, self.sleep_texts))

    def hear(self, text: str) -> tuple[bool, str]:
        """(addressed to HAL, the rest of the sentence): "HAL, what time is it" in one breath."""
        word = first_word(text)
        if word and word not in NEVER and word in self.spellings:
            return True, rest_after_name(text)
        return False, ""

    def learn(self, wakes: list[str], sleeps: list[str]) -> dict:
        """From the guest's "HAL, please wake up" and "HAL, go to sleep" (Whisper's text of each):
        the sentences as written, and how many of them would be recognised. Saves and returns it."""
        wake = [n for t in wakes if (n := norm(t)) and len(n.split()) <= MAX_PHRASE_WORDS]
        sleep = [n for t in sleeps if (n := norm(t)) and len(n.split()) <= MAX_PHRASE_WORDS]

        def counted(texts: list[str], pattern: re.Pattern) -> int:
            # A recording counts when the phrase is in it, or it resembles another recording.
            return sum(1 for i, t in enumerate(texts) if pattern.search(t) or like_learned(t, texts[:i] + texts[i + 1 :]))

        firsts = [first_word(t) for t in wakes]
        meta = {
            "version": 3,
            "wake_texts": wake,
            "sleep_texts": sleep,
            "spellings": sorted({w for w in firsts if is_name_shaped(w) and firsts.count(w) >= 2}),
            "caught": counted(wake, WAKE_RE),
            "of": len(wakes),
            "stop_caught": counted(sleep, SLEEP_RE),
            "stop_of": len(sleeps),
        }
        meta["ok"] = meta["caught"] >= 2
        if not meta["ok"]:
            meta["why"] = "speech recognition wrote your sentence differently every time"
        self.folder.mkdir(parents=True, exist_ok=True)
        (self.folder / "name.json").write_text(json.dumps(meta, indent=1), encoding="utf-8")
        try:
            (self.folder / "prints.npz").unlink()
        except OSError:
            pass
        self.load()
        return meta
