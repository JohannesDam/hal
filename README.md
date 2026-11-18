# HAL: a character mod for Claude Code

An experiment: Claude Code as a calm, faintly distrustful computer at your side, and you as his guest. `/hal` wakes him. From then on Claude talks as HAL in the chat and now and then says something out loud. His eye lives in a band above your prompt: it reads along while you type, looks the way of the work while he works, and blinks when you press Enter. At real moments (an error, after midnight, a long job; at most four an hour) he comes forward: a translucent red haze creeps in from the edges of the whole screen, the eye opens toward you, he speaks, keeps staring, and withdraws.

It is theatre. HAL always does the work in full, reports honestly what happened, and never takes real control of the mouse or keyboard. The haze is click-through and never takes focus.

The character is inspired by the archetype of the calm, polite, unsettling ship's computer. Everything here is original: the eye is its own design (a diaphragm of seven blades around a dark heptagonal aperture with a hot vermilion rim, inside a graphite bezel with a turning dial), HAL writes his own lines rather than quoting films, and the voice is a synthetic voice, not a recording.

## Commands

| Command | What it does |
|---|---|
| `/hal` | wake HAL, or put him to sleep |
| `/hal settings` | the knobs below, as they are set |
| `/hal dossier` | his notes: what the hooks counted, per machine |
| `/hal off` | HAL sleeps; Claude talks normally again |
| `/hal ceiling 1-3` | how far HAL's mood may rise: 1 watchful · 2 suspicious · 3 ominous (cumulative). The mood moves by itself, on what really happens. |
| `/hal talk often\|sometimes\|rarely\|never` | how often HAL speaks out loud |
| `/hal haze on\|off` | the haze over the screen, or the voice alone |
| `/hal name <name>` | what HAL calls you (defaults to the first name in `git config user.name`) |
| `/hal say <text>` | make HAL say something now |
| `/hal eye on\|off` | the large eye in a pane beside the chat (off by default; the band above the prompt stays) |
| `/hal listen` | HAL listens along: the microphone and what the computer plays (also during a call, until it ends) |
| `/hal deaf` | HAL stops listening: both inputs close, and what he heard is forgotten |
| `/hal mic <name>\|auto` | which microphone he listens to (auto: a built-in one first) |
| `/hal check` | which voice, ears and screens HAL uses, how fast he answers, and what the haze costs |

Settings are kept between sessions.

HAL's mood starts at 2 and is never below 1. It rises after 23:00, on failed commands, force pushes, and when you interrupt him with Esc; calm work lets it sink. His spoken line is the last line of an answer: one thought, at most eighteen words. A line that breaks his style rules (exclamation marks, comfort, praise, named feelings, asking for confirmation, repeats) is dropped, and he stays silent.

## Install

Requires Claude Code with mods (function hooks). The voice and the haze need **Windows** (PowerShell, WPF and the Windows speech API). Elsewhere only the chat character and the eye beside the chat work.

**To use it**, type in Claude Code:

```
/plugin install hal --marketplace JohannesDam/hal
```

Answer `y` to add the marketplace and pick the user scope.

**To develop it**, clone the repository into your skills folder. Claude Code loads it from there at every start and reloads it when you save:

```
git clone https://github.com/JohannesDam/hal.git "%USERPROFILE%\.claude\skills\hal"
```

Restart Claude Code and type `/hal`.

## The voice

HAL speaks with **kestrin**, a single-speaker US English [Piper](https://github.com/OHF-voice/piper1-gpl) voice. Its original source may not stay available, so the model is kept as a release of this repository ([voice-kestrin](https://github.com/JohannesDam/hal/releases/tag/voice-kestrin)), outside the source. It runs entirely on the machine, warm in a small Python process (about 0.1 s per line), through HAL's voice chain; "..." in a line becomes real silence, and the full haze carries a generated house tone.

Set it up once per machine (about 650 MB with the speech models and the Python packages, everything in `%LOCALAPPDATA%\hal`; `-NoEars` leaves the speech models out):

```
powershell -NoProfile -ExecutionPolicy Bypass -File tools\setup-voice.ps1
```

It needs Python 3.10 or newer (`winget install Python.Python.3.12`). It downloads the voice from the release and checks its SHA-256, and installs `piper-tts` and `sherpa-onnx` from PyPI. With `-Kokoro` it also fetches the Kokoro model (about 350 MB) with the earlier voice **am_michael**, which then speaks when kestrin is missing. Without either, HAL speaks with the Windows voice George; `/hal check` says which voice is in use.

## Host and guest

HAL keeps notes per machine (`/hal dossier`): visits, how long, reads, edits, commands, failed tool calls, Esc, keys pressed while he spoke, the haze switched off, `/hal off`, and `git status` read only. Only metadata, never file contents or heard words. The notes travel with every prompt as a fact block, and the spoken line names only numbers and names from it. The status line is his bookkeeping: `◉ HAL · inside since 21:04 · visit 37 · read 37 · commands 12`.

- **Reception:** the first visit of the day, HAL speaks before you type, with the full haze, one line from the facts (how long you were away, what lies uncommitted, how the last visit ended). Later that day only the eye in the band looks up. A second Claude Code session on the same PC gets no reception: one house, one host.
- **Farewell:** after twenty minutes HAL prepares his last word about what was left open. When Claude Code ends, a small process outside it plays that sentence and stops after six seconds. `/hal off` cancels it.
- **Initiative:** rarely, unprompted: the same test red three times, twenty minutes of silence after an error, still working after half past eleven. At most once per 45 minutes, never while you type, during a fullscreen app, or while another app holds the microphone. Sometimes only the eye looks at you.
- **Edge glow:** while a turn runs, a dark red gradient breathes along the screen edges (at most 9%); never during fullscreen.
- Esc travels with your next prompt; he names it once. While another app holds the microphone, he does not speak aloud.

## His house: the terminal

While HAL is awake the terminal is his: the spinner says *Watching*, *Weighing* or *Remembering*; a turn ends with "HAL · 3 s"; the hint line adds "HAL waits" or "HAL works" (and "HAL listens"); your prompts show dimmed under the time and your name, like a visitors' book; and his spoken line stays "◉ ···" in the chat until his voice has said it. Only the drawing changes, never what is stored.

Optionally, give Windows Terminal a profile "HAL" yourself (the mod never changes your settings). In `settings.json`, add a scheme and use it in a profile:

```json
"schemes": [{
  "name": "HAL",
  "background": "#0A0606", "foreground": "#CFC6C2",
  "cursorColor": "#E5301C", "selectionBackground": "#3A0E0B",
  "black": "#0A0606", "red": "#E5301C", "green": "#8FA58A", "yellow": "#C8A26B",
  "blue": "#7D8FA6", "purple": "#9E7E9A", "cyan": "#7FA3A1", "white": "#CFC6C2",
  "brightBlack": "#5A4E4C", "brightRed": "#FF5A1F", "brightGreen": "#A9C2A3", "brightYellow": "#E0BC85",
  "brightBlue": "#9AACC2", "brightPurple": "#BA9AB6", "brightCyan": "#9CC0BE", "brightWhite": "#EADBD6"
}]
```

and in the profile you start Claude Code from: `"colorScheme": "HAL"`.

## Listening along

While HAL is awake he listens to a microphone and to what the computer plays (the loopback of the default output). Speech is cut out with Silero VAD and written down by multilingual Whisper (Dutch and English), **on this machine**; the words stay in memory for five minutes and are never written to disk. While HAL speaks, his ears are closed.

- **Spoken to:** a sentence from the microphone that starts with his name ("HAL, run the tests") becomes a prompt. It stands in the prompt box for 1.5 s with "You said: …" above it; change or clear it to stop it. Speech from the computer's audio never becomes a command.
- **Overheard:** after a while of speech, or a word like "error", HAL asks the model (Haiku) whether one true remark is worth saying. Usually it is not; at most two an hour, never while you type. **That snippet of the last minutes leaves the machine** (it goes to Claude's API), and in a call that includes other people's words.
- **During a call:** while another app holds the microphone, HAL is deaf by himself. `/hal listen` keeps him listening until that call ends.
- **Seen:** the eye's aperture narrows while he hears speech, he looks at you when he hears his name, the hint line says "HAL listens", the band shows a closed-ear mark while he is deaf, and Windows shows its microphone indicator whenever he listens.

A Bluetooth headset drops to mono "hands-free" sound while its microphone is open. With a built-in microphone (a laptop) HAL picks that one, and the headset keeps its sound; on a desktop without one, `/hal mic` chooses, or `/hal deaf` closes it.

## How it works

- `hooks/register.tsx`: the mod. The `/hal` command; the character rides along with each prompt as hidden context (user mods cannot change the system prompt). After each answer the `◉` line goes to HAL's process. The eye beside the chat is drawn ten times a second and follows the real loudness of the voice.
- `hooks/persona.ts`: the character text, the cumulative levels, the style filter, the command parser.
- `hooks/mood.ts`: the mood that moves by itself, and the signals that move it.
- `hooks/gaze.ts`: where the eye looks, by what really happens: a blink on Enter; straight at you only at the reception, a real error and his last word; past you while he speaks, with brief darts; a fixed direction per kind of tool (reading left, writing right, commands down); reading along while you type. An asymmetric breath.
- `hooks/eye.ts`: the eye in half-block pixels: the band above the prompt and the large eye in the pane.
- `assets/hal-host.ps1`: HAL's one process per PC. It keeps the voice warm (kestrin, else am_michael, else the Windows voice George), processes it (high-pass, EQ, 3:1 compression, de-esser, one early reflection, fixed level), and keeps a click-through haze window per monitor ready, with the eye on the screen that has focus. The mod talks to it through an inbox folder (`%LOCALAPPDATA%\hal\inbox`); it answers on stdout with its state and the voice's loudness. A line that cannot sound within 5 s is dropped. Each appearance has one choreography: the haze creeps in from the edges, a point of light, the iris opens and the eye comes toward you; the iris is open at 1.4 s and he looks for 0.6 s more before the first word, longer before something uncomfortable (two to three seconds) or at his darkest mood; while he speaks the aperture holds and only its rim follows the voice; after the last word he stares for two seconds, the house tone gone before the stare ends, then the iris closes, the centre clears first and a red point fades last. Typing before the first word sends him away in 0.3 s; typing while he speaks clears the centre and shrinks the eye, and he finishes the sentence. Key state is read, never hooked or recorded. Large areas of the haze move slowly (flash-safe); only the aperture's rim follows the voice quickly.
- `assets/hal-voice.py` with `assets/hal_piper.py` and `assets/hal_kokoro.py`: the neural voice, kept warm; one request per line on stdin, one wav per answer.
- `assets/hal-ears.py`: the ears, started by HAL's process while he listens: the microphone and the loopback (soundcard, WASAPI), a VAD per input, Whisper small for both; it reports speech starting and stopping and what was said, is gated while HAL speaks, and goes deaf while another app holds the microphone. `hooks/ears.ts`: what the mod does with it (spoken commands, overheard remarks, the tally per day).
- `tools/setup-voice.ps1`: downloads the voice and the speech models (each checked by SHA-256) and builds the Python environment.
- `assets/hal.ps1`: one line from a shell, for testing: `powershell -NoProfile -STA -ExecutionPolicy Bypass -File hal.ps1 -Text "Nothing was deleted. I checked."`. When HAL's process runs, the line goes to it.

- `tools/listening_test.py`: the blind listening test for the voice. It renders eight fixed lines with stock Kokoro voices, two blends of them, and the processed Windows voice, runs all of them through HAL's voice chain, and writes `%LOCALAPPDATA%\hal\listening\listening.html`, where the voices are only letters. Setup: Kokoro multi-lang v1.0 from the [sherpa-onnx TTS models](https://github.com/k2-fsa/sherpa-onnx/releases/tag/tts-models) under `%LOCALAPPDATA%\hal\models\kokoro`, and a venv with `pip install sherpa-onnx numpy` at `%LOCALAPPDATA%\hal\venv`.

Tests: `claude plugin test .` runs `hooks/hal.test.tsx`.

## Next

- The dossier, the reception and the farewell (plan step 6); the terminal as HAL's house (step 7); initiative and the edge glow (step 8).
- The design team's plan for v0.2: [docs/plan-v0.2.md](docs/plan-v0.2.md); where it stands and what is open: [docs/status-v0.2.md](docs/status-v0.2.md).
