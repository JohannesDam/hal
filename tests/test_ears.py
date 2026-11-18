"""Tests for the ears' text side: how HAL is called (hal_name.py) and what counts as noise.

    python -m unittest discover -s tests        (with the venv's Python, from the repository)

No microphone, no model: Whisper's output is given as text, as the ears would get it.
"""

import importlib.util
import json
import sys
import tempfile
import unittest
from pathlib import Path

ASSETS = Path(__file__).resolve().parent.parent / "assets"
sys.path.insert(0, str(ASSETS))

from hal_name import Name, first_word, is_name_shaped, is_stop_word, norm, rest_after_name  # noqa: E402


def load_ears():
    spec = importlib.util.spec_from_file_location("hal_ears", ASSETS / "hal-ears.py")
    module = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(module)
    return module


class Sentences(unittest.TestCase):
    def setUp(self):
        self.name = Name(Path(tempfile.mkdtemp()))

    def test_wake_however_the_name_comes_out(self):
        for text in ["Hell, please wake up.", "Go, wake up.", "HAL, word wakker.", "Please wake up"]:
            self.assertTrue(self.name.is_wake(text), text)

    def test_wake_only_as_a_short_utterance(self):
        for text in ["I really need to wake up earlier tomorrow, I think.", "Go home now.", ""]:
            self.assertFalse(self.name.is_wake(text), text)

    def test_sleep_and_stop_end_it(self):
        for text in ["Hell, go to sleep.", "Go to sleep.", "Stop.", "stopp", "Stoppen!", "Oh, ga te sleepen.", "HAL, ga slapen."]:
            self.assertTrue(self.name.is_stop(text), text)
        for text in ["Top.", "Stop the build.", "The kids did not want to go to sleep last night at all.", "[BLANK_AUDIO]"]:
            self.assertFalse(self.name.is_stop(text), text)

    def test_one_breath_command(self):
        self.assertEqual(self.name.hear("Hell, what time is it?"), (True, "What time is it?"))
        self.assertEqual(self.name.hear("Hey HAL, run the tests."), (True, "Run the tests."))
        self.assertEqual(self.name.hear("HAL."), (True, ""))
        for text in ["Go home now.", "Oh, I see.", "Hello there.", "Al gedaan, dank je wel."]:
            self.assertEqual(self.name.hear(text), (False, ""), text)


class Learning(unittest.TestCase):
    def setUp(self):
        self.folder = Path(tempfile.mkdtemp())
        self.name = Name(self.folder)

    def test_learns_near_misses_of_the_guest_own_sentences(self):
        result = self.name.learn(
            ["Go, please wake app.", "Whole, please wake up.", "Paul please wake up"],
            ["Hell, go to sleep.", "Go, go to sleep.", "Oh go to sleap"],
        )
        self.assertTrue(result["ok"])
        self.assertEqual((result["caught"], result["of"], result["stop_caught"], result["stop_of"]), (3, 3, 3, 3))
        self.assertTrue(self.name.is_learned)
        self.assertTrue(self.name.is_wake("Home, please wait up."))
        self.assertTrue(self.name.is_stop("Oh go to sleap."))
        self.assertFalse(self.name.is_wake("Go home now."))
        # Kept on disk, read back by a new instance; only text, never audio.
        again = Name(self.folder)
        self.assertTrue(again.is_wake("Home, please wait up."))
        self.assertEqual(sorted(p.name for p in self.folder.iterdir()), ["name.json"])

    def test_a_weak_result_says_why(self):
        result = self.name.learn(["Blank.", "Oh.", "Gone."], [])
        self.assertFalse(result["ok"])
        self.assertIn("why", result)

    def test_forget_leaves_nothing(self):
        self.name.learn(["Hell, please wake up."] * 3, ["Hell, go to sleep."] * 3)
        (self.folder / "prints.npz").write_bytes(b"left by an older version")
        self.name.forget()
        self.assertEqual(list(self.folder.iterdir()), [])
        self.assertFalse(self.name.is_learned)

    def test_an_older_file_is_read_safely(self):
        old = {"version": 1, "threshold": 1.7, "spellings": ["blank", "go", "oh"], "caught": 3, "of": 5, "margin": -0.2, "ok": True}
        (self.folder / "name.json").write_text(json.dumps(old), encoding="utf-8")
        name = Name(self.folder)
        self.assertFalse(name.is_learned)
        self.assertEqual(name.hear("Go home now."), (False, ""))
        self.assertEqual(name.hear("Oh, I see."), (False, ""))


class Words(unittest.TestCase):
    def test_helpers(self):
        self.assertEqual(norm("[BLANK_AUDIO] Hell, please wake up!"), "hell please wake up")
        self.assertEqual(first_word("(music) Hal."), "hal")
        self.assertEqual(rest_after_name("Hal."), "")
        for word in ["hal", "hall", "hell", "haul"]:
            self.assertTrue(is_name_shaped(word), word)
        for word in ["oh", "go", "how", "hello", "help", "blank"]:
            self.assertFalse(is_name_shaped(word), word)
        self.assertTrue(is_stop_word("Stop."))
        self.assertFalse(is_stop_word("stop the build"))


class PreRollAndLanguage(unittest.TestCase):
    def test_pre_roll_adds_what_came_just_before(self):
        import numpy as np

        ears = load_ears()
        history = np.arange(48000, dtype=np.float32)  # the last 3 s fed to the VAD, fed = 60000
        segment = np.ones(8000, dtype=np.float32)
        padded = ears.with_pre_roll(segment, 40000, 60000, history)
        self.assertEqual(len(padded), 8000 + ears.PRE_ROLL)
        self.assertEqual(padded[0], 40000 - ears.PRE_ROLL - 12000)  # history starts at sample 12000
        # Indices that do not fit (after a reset) add nothing.
        self.assertEqual(len(ears.with_pre_roll(segment, 70000, 60000, history)), 8000)
        self.assertEqual(len(ears.with_pre_roll(segment, 5000, 60000, history)), 8000)
        # Close to the start of the history: only what there is.
        self.assertEqual(len(ears.with_pre_roll(segment, 12100, 60000, history)), 8000 + 100)

    def test_a_call_survives_a_wrong_language_label(self):
        ears = load_ears()
        self.assertTrue(ears.call_despite_language("Hell, please wake up.", "de"))
        self.assertTrue(ears.call_despite_language("Hal, go to sleep.", "af"))
        self.assertFalse(ears.call_despite_language("Und die Warnke zu sehen und", "de"))
        self.assertFalse(ears.call_despite_language("Στοπ!", "el"))
        self.assertFalse(ears.call_despite_language("Hell, please wake up.", "en"))  # not noise to begin with


class Noise(unittest.TestCase):
    def test_whisper_noise_is_dropped(self):
        ears = load_ears()
        self.assertTrue(ears.is_noise("වවවවවවවව", "nn"))
        self.assertTrue(ears.is_noise("Thanks for watching!", "en"))
        self.assertTrue(ears.is_noise("[BLANK_AUDIO]", "en"))
        self.assertTrue(ears.is_noise("Στοπ!", "el"))
        self.assertFalse(ears.is_noise("Hell, please wake up.", "en"))
        self.assertFalse(ears.is_noise("Ik ga even koffie halen.", "nl"))


if __name__ == "__main__":
    unittest.main()
