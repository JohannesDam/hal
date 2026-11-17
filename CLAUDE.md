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

- `hooks/register.tsx` the mod · `persona.ts` character text, style filter, commands · `mood.ts` mood and signals · `gaze.ts` where the eye looks · `eye.ts` the band and pane eye in half-block pixels · `ears.ts` what the mod does with what HAL hears · `dossier.ts` the notes and the fact block · `moments.ts` HAL's own lines (reception, waking, initiative, farewell) and when he may speak unprompted · `hal.test.tsx` and `units.test.ts` tests.
- `assets/hal-host.ps1` one process per PC: voice, processing chain, haze windows, choreography; inbox `%LOCALAPPDATA%\hal\inbox` in, JSON lines on stdout out. `assets/hal-voice.py` + `hal_piper.py` the warm neural voice (Piper `kestrin`; `hal_kokoro.py` for Kokoro `am_michael` when kestrin is missing). `assets/hal-ears.py` the ears (mic + loopback, VAD, Whisper), started by the host while the mod asks HAL to listen. `assets/hal-farewell.ps1` the last word, started through WMI by the host. `assets/hal.ps1` one line from a shell.
- `tools/setup-voice.ps1` voice + Python environment · `tools/listening_test.py` the blind test.
- Models and the venv live in `%LOCALAPPDATA%\hal`, never in the repo. The kestrin model is a GitHub release asset (`voice-kestrin`); `setup-voice.ps1` pins its SHA-256.

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
- `$.process.spawn` children inherit handles: the voice helper exits when its stdin closes.
- sherpa-onnx 2.0 has no espeak-ng: a Piper voice cannot phonemize there. Piper voices run through `piper-tts`, which brings its own espeak-ng.
- .NET's redirected stdin may begin with a UTF-8 BOM (when the console input encoding is UTF-8): Python reads the pipe as `utf-8-sig`.
- Windows PowerShell drops double quotes inside arguments to native programs: `python -c` code uses single quotes only.
- `python -I` ignores `PYTHONIOENCODING`; use `-X utf8` to print IPA or other non-ANSI text.
- soundcard sets its own warnings to "always" when imported: filter warnings after importing it.
- Whisper writes something for every segment: noise comes back as phonetic signs, brackets, another language or a stock phrase ("Thanks for watching"). `is_noise` in `hal-ears.py` drops those.
- A Bluetooth headset switches to mono hands-free while any app holds its microphone; HAL's voice then sounds like a phone call.
- The heard words never go to `$.ui.log` (the debug log is a file) or `$.store`.
- A mod cannot hear Esc at an idle prompt; `$.prompt.fill` + `$.prompt.read` give the person the last word instead.
- `$.process.spawn` has no live stdin: anything that needs one (the voice, the ears) is a child of the host.
- Never write a patch through a Bash heredoc: backslashes arrive halved, so `\\v` and `\\f` became a vertical tab and a form feed in the host. Write the patch script to a file first.
- Claude Code's exit takes its process tree along: the farewell waiter is created through WMI (`Win32_Process.Create`), so its parent is WmiPrvSE.
- HAL's own haze is a maximised topmost window, which `SHQueryUserNotificationState` reports as fullscreen: the host does not read the desk while HAL is on screen.
- In tests `$.store` is not reachable from the test's `$`: seed it with `mock.store(on, entries)` and read results through the mod's own commands (`/hal dossier`).
- A test's `$` needs answers for every engine call the mod makes: `session.id`, `model.complete`, `process.run` (git status), `fs.write`.
