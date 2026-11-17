# HAL v0.2: status

Where the build stands against [plan-v0.2.md](plan-v0.2.md): steps 1–4 are done, steps 5–9 are open. Each open item names what the plan asks and how to test it.

## Done

| Step | What |
|---|---|
| 1 | Tone fixed (no level 0, no stress rule, no sweet lines); mood moves by itself between 1 and a ceiling (default 3), levels cumulative; spoken line = last line, ≤ 18 words; style filter with forbidden list, last 30 lines, yardstick; character resent after `/clear` and compaction |
| 2 | One persistent process per PC (`hal-host.ps1`), inbox + stdout protocol, voice processing chain, haze window per monitor sized to the screen, flash-safe movement, `/hal check`; the eye redesigned as a 7-blade diaphragm |
| 3 | Choreography (entrance, voice ≥ 1.4 s, pause before uncomfortable lines, stare, exit with a fading red point), typing wins, the band above the prompt with attention-based gaze (blink on Enter, per-tool directions, reading along), haze budget 4/hour, eye-only appearances at level 3, side pane optional |
| 4 | Blind listening test; Kokoro **am_michael** kept warm in a Python helper; house tone under the full haze; `"..."` → 700 ms silence; `tools/setup-voice.ps1` |

Owner decisions recorded in the plan: voice am_michael (replaced by **kestrin**, a Piper voice the owner chose on 2026-11-18) · ceiling 3 · edge glow during a turn · farewell also after `/exit` · deaf during calls · Dutch and English speech recognition.

## Deviations from the plan, on purpose

- **Fallback voice.** The plan says no fallback voice. When no neural voice is *set up* on a machine, the Windows voice George speaks, so a fresh install is not mute; `/hal check` says so. When it is set up but fails, HAL shows only the haze and the subtitle, as planned.
- **No blend.** The plan suggested a blended voice; the owner chose plain am_michael in the blind test, and later the Piper voice kestrin (2026-11-18). Kokoro stays optional (`setup-voice.ps1 -Kokoro`) and speaks when kestrin is missing.
- **Recent lines.** The full character carries the last 30 spoken lines; the per-prompt note carries the last 12, to keep the context small.
- **Typing detection** reads key state (`GetAsyncKeyState`) instead of `GetLastInputInfo`, so mouse movement does not interrupt HAL. Lone modifiers do not count.
- **Inbox polling** every 150 ms instead of a FileSystemWatcher (more robust; a half-written message waits up to 2 s).

## Open

### Step 5: listening along (develop and test on the laptop)

- [ ] Inputs in the persistent process: the **built-in microphone** by default (a Bluetooth headset then stays in stereo) and **WASAPI loopback** of the default output.
- [ ] Silero VAD → speech recognition with sherpa-onnx, **multilingual Whisper** (decision 6: Dutch and English). Models to `%LOCALAPPDATA%\hal\models`; extend `tools/setup-voice.ps1`.
- [ ] Gate both inputs while HAL speaks, plus a 300 ms tail.
- [ ] Transcript only in memory, a rolling buffer of about five minutes; nothing on disk.
- [ ] **Addressed:** microphone speech starting with "HAL" → show "You said: …" in the band, wait 1.5 s for Esc, then `$.prompt.submit` marked as spoken. Never from loopback.
- [ ] **Overheard:** after 60–90 s of new speech or a salient word, ask `$.model` (Haiku) with the snippet and the fact block for one true remark; at most two an hour, never while typing; a full-haze moment.
- [ ] **Noticed:** heard speech becomes metadata in the dossier (when, how long, which input), never the words.
- [ ] The listening eye: pupil narrows and the gaze holds while speech is heard; looks at you on his name.
- [ ] `/hal deaf` and a hotkey; a closed-ear mark in the band; the Windows microphone indicator stays honest.
- [ ] **Decision 5:** deaf automatically while a call app holds the microphone; `/hal listen` overrides it for one call.
- [ ] The microphone guard ignores HAL's own process; another app holding the mic pauses HAL's speaking.
- [ ] Hint line "HAL listens" while the inputs are live.

*Test:* a video playing, a conversation in the room, three spoken commands. A video never commands Claude Code; at most two reactions an hour, each about something true.

### Step 6: host and dossier

- [ ] Hooks count: times, tool calls, failed commands, `git status` (read only), visit length, Esc while HAL speaks, haze switched off, `/hal off`. Metadata only, in `$.store`, per machine.
- [ ] A fact block with every prompt; the spoken line names only numbers and names from it.
- [ ] `/hal dossier` ("my notes"); one sharp detail at most once per session.
- [ ] **Reception** at `session.start` on the first visit of the day, full haze, from the fact block (time since the last visit, uncommitted work, how the last visit ended). Back within the hour: only the band's eye looks up. `/clear` is not a visit.
- [ ] **Farewell** (decision 4): after a session over 20 minutes, one sentence about what was left open, pre-rendered; spoken by a detached process that watches Claude Code's pid and stops hard after 6 s, also after `/exit`.
- [ ] `/hal` toggles without a table; ceiling, haze, talk, pane and name under `/hal settings`.
- [ ] Status line as bookkeeping: `◉ HAL · inside since 21:04 · visit 37 · read 37 · commands 12`.
- [ ] Esc (`turn.abort`) goes as hidden context with the next prompt; HAL names it once, factually.
- [ ] Switching off is named once, as a bare fact, at the next reception.

*Test:* start the next morning. Is what he says true? Is the dossier right?

### Step 7: the terminal as HAL's house

- [ ] The ◉ line without spoilers: "◉ ···" in the chat, the dimmed text after the last spoken word (custom `AssistantMessage` rendering, `$.ui.invalidate`); the text at once when voice or haze fails; Ctrl+O shows the original.
- [ ] Subtitle per phrase in the haze (24 DIP, #EADBD6 at 85%).
- [ ] Visitor log: prompts dimmed (#B8AEAA) with "14:02 · name"; rendering only, never the text.
- [ ] Own words: spinner ("watching", "weighing", "remembering"), duration line "HAL · 3 s", hint line "HAL waits" / "HAL works · esc interrupts".
- [ ] Document the Windows Terminal profile "HAL" (background #0A0606, text #CFC6C2, cursor #E5301C, selection #3A0E0B) in the README; the mod never changes it.

*Test:* does the terminal feel like his space while everything stays readable?

### Step 8: initiative and edge glow

- [ ] Unprompted speech via `$.clock` + `$.model.complete` (Haiku) with the fact block. Triggers: the same test red three times, twenty minutes of silence after an error, still working after 23:30, back after days away. At most once per 45 minutes; never while typing, during fullscreen (`SHQueryUserNotificationState`), or while another app holds the mic. Silent form: the band's eye brightens and looks at you. What he said goes as hidden context with the next prompt. Never `$.prompt.submit`.
- [ ] **Edge glow** (decision 3): four click-through windows along the screen edges, a 60 DIP gradient in #5A0603, breathing up to 9% opacity, only while a turn runs, about 10 fps. Measure CPU first.

*Test:* an afternoon with errors. At most once per 45 minutes unprompted, never while typing.

### Step 9: a week on the laptop

- [ ] `/hal check`; measure the Bluetooth offset per output device (about 150–250 ms) and apply it.
- [ ] Repeat the listening test on laptop speakers (`tools/listening_test.py`).
- [ ] *Success* on day 7: HAL still on, haze not switched off, no two spoken lines remembered word for word. The dossier (Esc, haze off, `/hal off`) shows honestly whether it annoys.

### Smaller leftovers

- [ ] Look straight at you when you fall silent after HAL asked a question.
- [ ] Render the final phrase at speed 0.85, if a listening test approves.
- [ ] Try `prompt.context` for the character instead of resending it (a test must show user mods may use it).
