# HAL: a character mod for Claude Code

An experiment: Claude Code as a calm, faintly distrustful computer at your side, and you as his guest. `/hal` wakes him. From then on Claude talks as HAL in the chat and now and then says something out loud. His eye lives in a band above your prompt: it reads along while you type, looks the way of the work while he works, and blinks when you press Enter. At real moments (an error, after midnight, a long job; at most four an hour) he comes forward: a translucent red haze creeps in from the edges of the whole screen, the eye opens toward you, he speaks, keeps staring, and withdraws.

It is theatre. HAL always does the work in full, reports honestly what happened, and never takes real control of the mouse or keyboard. The haze is click-through and never takes focus.

The character is inspired by the archetype of the calm, polite, unsettling ship's computer. Everything here is original: the eye is its own design (a diaphragm of seven blades around a dark heptagonal aperture with a hot vermilion rim, inside a graphite bezel with a turning dial), HAL writes his own lines rather than quoting films, and the voice is a synthetic voice, not a recording.

## Commands

| Command | What it does |
|---|---|
| `/hal` | wake HAL, or show the settings when he is awake |
| `/hal off` | HAL sleeps; Claude talks normally again |
| `/hal ceiling 1-3` | how far HAL's mood may rise: 1 watchful · 2 suspicious · 3 ominous (cumulative). The mood moves by itself, on what really happens. |
| `/hal talk often\|sometimes\|rarely\|never` | how often HAL speaks out loud |
| `/hal haze on\|off` | the haze over the screen, or the voice alone |
| `/hal name <name>` | what HAL calls you (defaults to the first name in `git config user.name`) |
| `/hal say <text>` | make HAL say something now |
| `/hal eye on\|off` | the large eye in a pane beside the chat (off by default; the band above the prompt stays) |
| `/hal check` | which voice and screens HAL uses, how fast he answers, and what the haze costs |

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

Set it up once per machine (about 280 MB with the Python packages, everything in `%LOCALAPPDATA%\hal`):

```
powershell -NoProfile -ExecutionPolicy Bypass -File tools\setup-voice.ps1
```

It needs Python 3.10 or newer (`winget install Python.Python.3.12`). It downloads the voice from the release and checks its SHA-256, and installs `piper-tts` and `sherpa-onnx` from PyPI. With `-Kokoro` it also fetches the Kokoro model (about 350 MB) with the earlier voice **am_michael**, which then speaks when kestrin is missing. Without either, HAL speaks with the Windows voice George; `/hal check` says which voice is in use.

## How it works

- `hooks/register.tsx`: the mod. The `/hal` command; the character rides along with each prompt as hidden context (user mods cannot change the system prompt). After each answer the `◉` line goes to HAL's process. The eye beside the chat is drawn ten times a second and follows the real loudness of the voice.
- `hooks/persona.ts`: the character text, the cumulative levels, the style filter, the command parser.
- `hooks/mood.ts`: the mood that moves by itself, and the signals that move it.
- `hooks/gaze.ts`: where the eye looks, by what really happens: a blink on Enter; straight at you only at the reception, a real error and his last word; past you while he speaks, with brief darts; a fixed direction per kind of tool (reading left, writing right, commands down); reading along while you type. An asymmetric breath.
- `hooks/eye.ts`: the eye in half-block pixels: the band above the prompt and the large eye in the pane.
- `assets/hal-host.ps1`: HAL's one process per PC. It keeps the voice warm (kestrin, else am_michael, else the Windows voice George), processes it (high-pass, EQ, 3:1 compression, de-esser, one early reflection, fixed level), and keeps a click-through haze window per monitor ready, with the eye on the screen that has focus. The mod talks to it through an inbox folder (`%LOCALAPPDATA%\hal\inbox`); it answers on stdout with its state and the voice's loudness. A line that cannot sound within 5 s is dropped. Each appearance has one choreography: the haze creeps in from the edges, a point of light, the iris opens and the eye comes toward you; the voice never starts before 1.4 s, and waits two to three seconds before something uncomfortable; after the last word he stares, then the iris closes, the centre clears first and a red point fades last. Typing before the first word sends him away in 0.3 s; typing while he speaks clears the centre and shrinks the eye, and he finishes the sentence. Key state is read, never hooked or recorded. Large areas of the haze move slowly (flash-safe); only the aperture's rim follows the voice quickly.
- `assets/hal-voice.py` with `assets/hal_piper.py` and `assets/hal_kokoro.py`: the neural voice, kept warm; one request per line on stdin, one wav per answer.
- `tools/setup-voice.ps1`: downloads the voice and builds the Python environment.
- `assets/hal.ps1`: one line from a shell, for testing: `powershell -NoProfile -STA -ExecutionPolicy Bypass -File hal.ps1 -Text "Nothing was deleted. I checked."`. When HAL's process runs, the line goes to it.

- `tools/listening_test.py`: the blind listening test for the voice. It renders eight fixed lines with stock Kokoro voices, two blends of them, and the processed Windows voice, runs all of them through HAL's voice chain, and writes `%LOCALAPPDATA%\hal\listening\listening.html`, where the voices are only letters. Setup: Kokoro multi-lang v1.0 from the [sherpa-onnx TTS models](https://github.com/k2-fsa/sherpa-onnx/releases/tag/tts-models) under `%LOCALAPPDATA%\hal\models\kokoro`, and a venv with `pip install sherpa-onnx numpy` at `%LOCALAPPDATA%\hal\venv`.

Tests: `claude plugin test .` runs `hooks/hal.test.tsx`.

## Next

- Listening along: speech input through the microphone and the computer's audio (plan step 5).
- The design team's plan for v0.2: [docs/plan-v0.2.md](docs/plan-v0.2.md); where it stands and what is open: [docs/status-v0.2.md](docs/status-v0.2.md).
