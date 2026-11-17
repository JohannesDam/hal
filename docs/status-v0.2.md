# HAL v0.2: status

Where the build stands against [plan-v0.2.md](plan-v0.2.md): steps 1–4 are done; steps 5–8 are built and wait for a live test; step 9 (a week on the laptop) is open. Each open item names what the plan asks and how to test it.

## Done

| Step | What |
|---|---|
| 1 | Tone fixed (no level 0, no stress rule, no sweet lines); mood moves by itself between 1 and a ceiling (default 3), levels cumulative; spoken line = last line, ≤ 18 words; style filter with forbidden list, last 30 lines, yardstick; character resent after `/clear` and compaction |
| 2 | One persistent process per PC (`hal-host.ps1`), inbox + stdout protocol, voice processing chain, haze window per monitor sized to the screen, flash-safe movement, `/hal check`; the eye redesigned as a 7-blade diaphragm |
| 3 | Choreography (entrance, voice ≥ 1.4 s, pause before uncomfortable lines, stare, exit with a fading red point), typing wins, the band above the prompt with attention-based gaze (blink on Enter, per-tool directions, reading along), haze budget 4/hour, eye-only appearances at level 3, side pane optional |
| 4 | Blind listening test; Kokoro **am_michael** kept warm in a Python helper; house tone under the full haze; `"..."` → 700 ms silence; `tools/setup-voice.ps1`. Later the Piper voice **kestrin** (about 0.1 s per line), from this repository's release `voice-kestrin` |
| 5 | Listening along, built (see step 5 below for what is tested) |
| 6 | Host and dossier, built: counts, fact block, `/hal dossier`, reception, farewell, bookkeeping in the status line, Esc as hidden context |
| 7 | The terminal as HAL's house, built: "◉ ···" until the line is said, the visitor log, his own words for the spinner, the duration line and the hint line |
| 8 | Initiative, the microphone guard and the edge glow, built |

Owner decisions recorded in the plan: voice am_michael (replaced by **kestrin**, a Piper voice the owner chose on 2026-11-18) · ceiling 3 · edge glow during a turn · farewell also after `/exit` · deaf during calls · Dutch and English speech recognition.

## Deviations from the plan, on purpose

- **Fallback voice.** The plan says no fallback voice. When no neural voice is *set up* on a machine, the Windows voice George speaks, so a fresh install is not mute; `/hal check` says so. When it is set up but fails, HAL shows only the haze and the subtitle, as planned.
- **No blend.** The plan suggested a blended voice; the owner chose plain am_michael in the blind test, and later the Piper voice kestrin (2026-11-18). Kokoro stays optional (`setup-voice.ps1 -Kokoro`) and speaks when kestrin is missing.
- **Recent lines.** The full character carries the last 30 spoken lines; the per-prompt note carries the last 12, to keep the context small.
- **Typing detection** reads key state (`GetAsyncKeyState`) instead of `GetLastInputInfo`, so mouse movement does not interrupt HAL. Lone modifiers do not count.
- **Inbox polling** every 150 ms instead of a FileSystemWatcher (more robust; a half-written message waits up to 2 s).
- **No Esc window for spoken commands.** A mod cannot hear Esc at an idle prompt. A command spoken to HAL stands in the prompt box for 1.5 s with "You said: …" in the band; any change to it (typing, clearing it) keeps it from being sent. With a draft already in the box, nothing is sent.
- **Microphone choice.** A built-in microphone first; else the Windows default, unless that is a virtual device (streaming, routing tools); else the first real one. `/hal mic <name>` picks one.
- **Whisper small** (int8, about 375 MB) instead of 100–250 MB: base misheard too much Dutch. Segments Whisper labels as another language than Dutch or English, or that are mostly signs, are dropped as noise.

## Open

### Step 5: listening along (built on the desktop with a Bluetooth headset; laptop test open)

`assets/hal-ears.py` (soundcard + Silero VAD + Whisper small, all local) runs under the host, which relays its lines and gates it; `hooks/ears.ts` holds what the mod does with them.

- [x] Inputs in the persistent process: a microphone (built-in first) and **WASAPI loopback** of the default output, which follows a change of the default.
- [x] Silero VAD → **multilingual Whisper small** through sherpa-onnx (decision 6). Models to `%LOCALAPPDATA%\hal\models`, fetched and checked by `tools/setup-voice.ps1`.
- [x] Gate both inputs while HAL speaks, plus a 300 ms tail. *Tested:* his own line through the loopback is not heard.
- [x] Transcript only in memory, a rolling buffer of five minutes in the mod; nothing on disk, nothing in the debug log.
- [x] **Addressed:** microphone speech starting with "HAL" (as speech recognition writes it: Hal, Hall, Hey HAL, …) → "You said: …" in the band, 1.5 s in the prompt box, then `$.prompt.submit` with a note that it was spoken. Never from loopback. *To test by voice.*
- [x] **Overheard:** after 75 s of new speech (or 8 s with a salient word), at most one weighing per 5 minutes, Haiku with the last minutes and a small fact block, for one true remark or SILENCE; at most two remarks an hour, never while typing or while HAL works; a full-haze moment; what he said goes with the next prompt as hidden context. *To test.*
- [x] **Noticed:** seconds of speech per day and input in `$.store` (`heard`), never the words.
- [x] The listening eye: the aperture narrows and the gaze holds while speech is heard; he looks at you on his name.
- [ ] `/hal deaf` (done: both inputs close, the mic indicator goes out) and a closed-ear mark in the band (done); **a hotkey** is open.
- [x] **Decision 5:** deaf while another app holds the microphone (read from the store behind Windows' mic indicator); `/hal listen` overrides it until that app lets go. *To test with a call.*
- [ ] The microphone guard ignores HAL's own process (done); **another app holding the mic pauses HAL's speaking** is open (step 8).
- [x] Hint line "HAL listens" while the inputs are live.

*Test:* a video playing, a conversation in the room, three spoken commands. A video never commands Claude Code; at most two reactions an hour, each about something true.

### Step 6: host and dossier (built; live test open)

`hooks/dossier.ts` holds the notes (`$.store` key `dossier`), `hooks/moments.ts` the requests for HAL's own lines, `assets/hal-farewell.ps1` the last word.

- [x] Hooks count per visit: reads, edits, commands, failed tool calls, Esc, keys pressed while HAL spoke, his spoken lines; per machine: visits, haze switched off, `/hal off`; `git status --porcelain --branch` read only (counts, branch, at most three file names). A reload of the mod is not a visit; `/clear` is not a visit; a visit left open by a crash ends as "unknown" after half an hour.
- [x] A fact block with every prompt ("HAL's notes"); the spoken line may name only numbers and names from it.
- [x] `/hal dossier` ("My notes."); one sharp detail at most once per session (a spoken line with a number marks it used).
- [x] **Reception**: the first visit of the day, once HAL's process is this session's (one house, one host), a line written by Haiku from the fact block, with the full haze; a later visit that day: only the band's eye looks up. No fixed greeting lists anywhere, also not for `/hal` itself.
- [x] **Farewell** (decision 4): after twenty minutes, and again at most every ten, Haiku writes the last word; the host renders it to `%LOCALAPPDATA%\hal\farewell-<pid>.wav` and starts `hal-farewell.ps1` through WMI (outside Claude Code's process tree), which waits for Claude Code to end, plays it and stops after 6 s. `/hal off` removes the wav: then silence. *Tested with a stand-in process.*
- [x] `/hal` switches on or off without a table; the knobs are under `/hal settings`.
- [x] Status line as bookkeeping: `◉ HAL · inside since 21:04 · visit 37 · read 37 · commands 12`.
- [x] Esc goes as hidden context with the next prompt, once; HAL names it once, factually.
- [x] Switching off is named once, as a bare fact, at the next reception (in the request to Haiku).
- [ ] *Live test:* the next morning, with the real voice.

*Test:* start the next morning. Is what he says true? Is the dossier right?

### Step 7: the terminal as HAL's house (built; live test open)

- [x] The ◉ line without spoilers: "◉ ···" in the chat while a turn runs and until the voice has said it (an `AssistantMessage` rewrite, redrawn through an atom); the words at once when the line is dropped, filtered or HAL may not speak, and within 30 s whatever happens. *Deviation:* the words come back plain, not dimmed (a text rewrite cannot dim one line). *Tested.*
- [x] Subtitle per phrase in the haze (24 DIP, #EADBD6 at 85%), timed by each phrase's share of the letters.
- [x] Visitor log: your prompts dimmed (#B8AEAA) under "14:02 · name" (", spoken" for one HAL heard); rendering only, never the text. A prompt from before a reload has no time.
- [x] Own words: the spinner says Watching (tools), Weighing (thinking) or Remembering (writing); the duration line "HAL · 3 s"; the hint line keeps the engine's own line (its pills and "esc to interrupt") and adds "· HAL waits" or "· HAL works", and "· HAL listens".
- [x] The Windows Terminal profile "HAL" is documented in the README; the mod never changes it.
- [x] *(leftover)* When an answer ends with a question and you stay silent, he looks straight at you after four seconds.

*Test:* does the terminal feel like his space while everything stays readable?

### Step 8: initiative and edge glow (built; live test open)

- [x] Unprompted speech, checked once a minute, written by Haiku with the fact block. Triggers: the same test command red three times in a row, twenty minutes of silence after a failed tool call, still working after 23:30 (once a night); back after days away is the reception. At most once per 45 minutes (kept across restarts); never while typing, while HAL works, during fullscreen (`SHQueryUserNotificationState`, read by the host; HAL's own haze is not counted), or while another app holds the microphone. When the model answers SILENCE: the silent form, the band's eye looks at you. What he said goes as hidden context with the next prompt. Never `$.prompt.submit`. Only the session that owns HAL's process speaks.
- [x] **The microphone guard:** while another app holds the microphone, HAL does not speak aloud (`/hal say` still does).
- [x] **Edge glow** (decision 3): four click-through windows per screen, a 60 DIP gradient in #5A0603, breathing up to 9% opacity, fading in over 2 s, only while a turn runs, away during fullscreen and while HAL is on screen. *Measured:* 8% of one core at 10 fps on 3440×1440, so it runs at 5 fps; `/hal check` reports the last figure.

*Test:* an afternoon with errors. At most once per 45 minutes unprompted, never while typing.

### Step 9: a week on the laptop

- [ ] `/hal check`; measure the Bluetooth offset per output device (about 150–250 ms) and apply it.
- [ ] Repeat the listening test on laptop speakers (`tools/listening_test.py`).
- [ ] *Success* on day 7: HAL still on, haze not switched off, no two spoken lines remembered word for word. The dossier (Esc, haze off, `/hal off`) shows honestly whether it annoys.

### Smaller leftovers

- [ ] Render the final phrase at speed 0.85, if a listening test approves.
- [ ] Try `prompt.context` for the character instead of resending it (a test must show user mods may use it).
