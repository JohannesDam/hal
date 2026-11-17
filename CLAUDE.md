# HAL: notes for working on this repository

A Claude Code mod (function hooks) that gives Claude a character: a calm, faintly distrustful computer that is the host, with the user as his guest. Read `README.md` for what it does, `docs/plan-v0.2.md` for the design, and `docs/status-v0.2.md` for what is done and what is open. Work through the open steps in order.

## Non-negotiables

- **Original design only.** The character is inspired by an archetype, not copied. No film quotes or paraphrased film dialogue, no film audio, no copy of the film's eye. The eye is our own: a seven-blade diaphragm with a hot vermilion rim.
- **Theatre only.** No keyboard or mouse hooks, no taking focus, no fake dialogs or crashes, nothing done on the system unasked. Key state may be read, never hooked or recorded. The work is always done in full and facts are reported plainly.
- **Not sweet.** No comfort, praise, exclamation marks, "friend", named feelings. Eerie, cold, true.
- **English everywhere in the repo** (code, comments, UI strings, docs, commit messages). Nothing personal in the repo: no names, emails, devices, habits.
- **Commit identity:** before the first commit on a machine, set this repo's identity to the GitHub noreply address:
  `git config user.name JohannesDam` and `git config user.email 16362235+JohannesDam@users.noreply.github.com`.

## Layout

- `hooks/register.tsx` the mod · `persona.ts` character text, style filter, commands · `mood.ts` mood and signals · `gaze.ts` where the eye looks · `eye.ts` the band and pane eye in half-block pixels · `hal.test.tsx` tests.
- `assets/hal-host.ps1` one process per PC: voice, processing chain, haze windows, choreography; inbox `%LOCALAPPDATA%\hal\inbox` in, JSON lines on stdout out. `assets/hal-voice.py` + `hal_kokoro.py` the warm Kokoro voice (`am_michael`). `assets/hal.ps1` one line from a shell.
- `tools/setup-voice.ps1` model + Python environment · `tools/listening_test.py` the blind test.
- Models and the venv live in `%LOCALAPPDATA%\hal`, never in the repo.

## Checks

- `claude plugin validate .` and `claude plugin test .` after every change to `hooks/`.
- The host from a shell: `powershell -NoProfile -STA -ExecutionPolicy Bypass -File assets\hal-host.ps1 -Say "Nothing was deleted. I checked." -IgnoreKeys` (`-IgnoreKeys` is for tests only; without it a key press during the entrance sends HAL away, as designed).

## Gotchas met so far

- PowerShell variable names ignore case: a local `$s` overwrites the state `$S`.
- `[Math]::Min(1, $x)` picks the integer overload and rounds `$x`: always write double literals (`1.0`).
- `.GetNewClosure()` hides the script's own functions when the script is called from another script: bind handlers through `Tag` instead.
- In Python strings, `"\v"` is a vertical tab: write Windows paths as raw strings.
- The mod's helpers that take `$` must be top-level function declarations (`claude plugin validate` refuses others).
- User mods cannot change the system prompt (`prompt.compose` is bypassed); the character rides along as `prompt.submit` context.
- sherpa-onnx insists on the model's exact speaker count in `voices.bin`; Kokoro's lexicon *skips* unknown words, so code words are split (`WebSocket` → `Web Socket`).
- `$.process.spawn` children inherit handles: the Kokoro helper exits when its stdin closes.
