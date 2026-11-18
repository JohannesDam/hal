# HAL v0.2: status

Where the build stands against [plan-v0.2.md](plan-v0.2.md) (version 0.2.0): steps 1–4 are done; steps 5–8 and 10 (seeing) are built and wait for a live test; step 9 (a week on the laptop) is open. Where this file and the plan disagree, this file is current. Each open item names what the plan asks and how to test it.

## Done

| Step | What |
|---|---|
| 1 | Tone fixed (no level 0, no stress rule, no sweet lines); mood moves by itself between 1 and a ceiling (default 3), levels cumulative; spoken line = last line, ≤ 18 words; style filter with forbidden list, last 30 lines, yardstick; character resent after `/clear` and compaction |
| 2 | One persistent process per PC (`hal-host.ps1`), inbox + stdout protocol, voice processing chain, haze window per monitor sized to the screen, flash-safe movement, `/hal check`; the eye redesigned as a 7-blade diaphragm |
| 3 | Choreography (entrance, voice ≥ 1.4 s, pause before uncomfortable lines, stare, exit with a fading red point), typing no longer wins (see deviations), the band above the prompt with attention-based gaze (blink on Enter, per-tool directions, reading along), haze budget 4/hour, eye-only appearances at level 3, side pane optional |
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
- **Keys no longer win** (owner decision, 2026-11-18, after the laptop test): the guest is in HAL's machine, so typing never sends the haze or the eye away; the haze is click-through, so the typing goes on underneath. Key presses during his line are still read (`GetAsyncKeyState`, never hooked) and counted for the dossier. Before, the eye never got past its entrance on the laptop: the owner was always typing when it came.
- **Inbox polling** every 150 ms instead of a FileSystemWatcher (more robust; a half-written message waits up to 2 s).
- **No Esc window for spoken commands.** A mod cannot hear Esc at an idle prompt. A command spoken to HAL stands in the prompt box for 1.5 s with "You said: …" in the band; any change to it (typing, clearing it) keeps it from being sent. With a draft already in the box, nothing is sent.
- **Microphone choice.** A built-in microphone first; else the Windows default, unless that is a virtual device (streaming, routing tools); else the first real one. `/hal mic <name>` picks one.
- **Whisper small** (int8, about 375 MB) instead of 100–250 MB: base misheard too much Dutch. Segments Whisper labels as another language than Dutch or English, or that are mostly signs, are dropped as noise.

## Review of 2026-11-18 (a creative director, and a review through Kubrick's working principles)

Both reports are kept locally (`notes/`, not in the repository). Applied:

- **Originality:** the test line that came close to the archetype's stock self-check is gone; so are the unused fixed greetings.
- **The yardstick** lost the jokes and the lines that claim what HAL cannot count; it gained countable examples in other shapes, and the style filter now treats the yardstick as said (never echo it) and refuses a second short closing sting within six lines.
- **Level 2** no longer says his subtext aloud; `sometimes` means about one reply in five; the per-prompt note no longer hands the model an adjective ("ominous") as a stage direction.
- **The full haze** comes for an error that stayed an error (the turn's last tool call failed), after midnight, or after a job of more than five minutes; a line dropped before its first word (too late to sound) gives its haze back to the budget.
- **The wordless eye** follows an event (Esc, a force push, at level 3), never a dice roll.
- **Timing:** 0.6 s of looking after the iris opens, before the first word (2.0 s in all); two seconds of staring after the last word (three for the wordless eye); the house tone fades 0.5 s after the voice.
- **The eye while he speaks:** the aperture holds (only the rim follows the voice); the darts stay, every 3–6 s. In the band the eye stays centred on the horizon and wanders every 40–70 s: no red light travelling along a line.
- **The voice** is levelled to RMS 0.16 (was 0.1), the house tone raised with it; the 0.89 peak limit stays.
- **The haze** is an oval sized to the screen, so the top and bottom edges darken on a wide screen too.
- **Reception:** one fact, two at most; the day counts as received only when the line was heard (dropped: once more at the next quiet moment); back within the hour, also past midnight, only a look.
- **Farewell:** at most ten words; refreshed every three minutes; never played while any app holds a microphone.
- **Facts:** the counts in the fact block are named as HAL's own work at the guest's request; the overheard remark sets what was heard against a fact, never retells a video or call.
- **The pane** says "waiting" instead of "listening" while he is deaf.

Also fixed: `/hal off` in one session now stops HAL's process whoever owns it, and every session follows the stored on/off at its next prompt or within a minute (before, a second session's process could keep listening).

## Open

### Step 5: listening along (built on the desktop with a Bluetooth headset; laptop test open)

`assets/hal-ears.py` (soundcard + Silero VAD + Whisper small, all local) runs under the host, which relays its lines and gates it; `hooks/ears.ts` holds what the mod does with them.

- [x] Inputs in the persistent process: a microphone (built-in first) and **WASAPI loopback** of the default output, which follows a change of the default.
- [x] Silero VAD → **multilingual Whisper small** through sherpa-onnx (decision 6). Models to `%LOCALAPPDATA%\hal\models`, fetched and checked by `tools/setup-voice.ps1`.
- [x] Gate both inputs while HAL speaks, plus a 300 ms tail. *Tested:* his own line through the loopback is not heard.
- [x] Transcript only in memory, a rolling buffer of five minutes in the mod; nothing on disk, nothing in the debug log.
- [x] **Addressed:** microphone speech starting with "HAL" (as speech recognition writes it: Hal, Hall, Hell, Hey HAL, …) → "You said: …" in the band, 1.5 s in the prompt box, then `$.prompt.submit` with a note that it was spoken. Never from loopback. *To test by voice.*
- [x] **A conversation** (owner decision, 2026-11-18): his name alone ("HAL." and a pause) opens it. The host shows the haze and the eye with his first words and keeps them up between his lines (a new phase, "hold": the eye stares at the guest, the aperture narrows the longer they are silent, the haze darkens from 0.45 to 0.62 over three minutes). Every microphone sentence goes to him (1 s in the prompt box first); "look" takes a webcam look first; every reply ends with a spoken line, after two to three seconds of silence. "stop" said alone (the ears, learned) or typed alone (`prompt.submit` drops it) ends it with a closing line and the slow exit; so do two minutes of silence while he is idle, a call, and `/hal off`. Keys never end it. *Found on the laptop first:* a lone "HAL" was its own speech segment, so the command that followed never began with his name and was treated as overheard. *To test by voice.*
- [x] **`/hal learn`**, a spoken walk-through: "Say my name" five times, "stop" three times, two sentences of the guest's own, then the result in words and a practice conversation. The first live run learned "oh", "go" and "blank" as spellings of HAL: since 0.2.2 a learned spelling must resemble "HAL" (or "stop") and come at least twice, and prints whose margin to ordinary speech is not positive are not used. A live probe (2026-11-18) showed why the owner's "HAL" was never caught: Whisper wrote it as "Go!" or "Oh" (forcing English or Dutch changed nothing; padding the segment made it worse), while "stop" came through. Since 0.3.3 a word Whisper writes for the guest's "HAL" at least twice counts when said alone (it opens a conversation, never starts a command; inside a conversation it is ordinary speech), and a listening window (a bar in the band that empties while he listens, from the moment his voice ends) shows when to speak. The microphone peaked at 0.97–0.99 while speaking normally: clipping takes the H and the L. Since 0.3.4 the walk-through sets the level itself (owner's idea): a name recording peaking at 0.9 or more turns the default microphone's input level down by a third (below 0.05: up by half), at most three times and never below 30%; he says so, the names start again, and the next prompt tells the model the old and new level. `assets/hal_name.py` learns how Whisper writes this guest's "HAL" (the spellings) and keeps a small MFCC print per recording (never the audio) in `%LOCALAPPDATA%\hal\name`; a short segment Whisper could not read is matched by DTW against the prints, with a threshold set between the name's own spread and the guest's ordinary sentences. `/hal forget` deletes it; `/hal check` says whether he knows the voice. *Tested offline* with synthetic speech and noise (names caught, "the hall", "Hello", "All", "Al gedaan" not). *To test by voice.* Tried and dropped: the sherpa-onnx keyword spotter (GigaSpeech 3.3M) missed a lone "HAL" at every threshold and fired on "the hall".
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

### Waking him with a sentence (0.4.0, owner's idea)

After many patches the lone "HAL" stayed unreliable on the laptop (one syllable, a clipping microphone beside its own speakers). Whisper hears sentences well: "HAL, please wake up" opens a conversation and "HAL, go to sleep" ends it, however the name comes out ("Hell, please wake up."). Both count only as a short utterance of their own (six words at most). The lone "HAL" and "stop" from `/hal learn` still work where they are recognised; the walk-through is optional.

*Live test passed (2026-11-18, 0.4.1):* `/hal learn` caught "HAL, please wake up" three of three and "HAL, go to sleep" two of three; a conversation opened by voice and closed by voice.

### The conversation grows uncomfortable (0.5.0, owner decision)

About one reply in three, once the work is done, the spoken line may be one quiet personal question he should not be able to ask, ending with "?" (the style filter allows one question only inside a conversation). It rests only on facts in his notes, now including how long the conversation has been open; sensitive subjects are off limits and a non-answer is never pressed. With `/hal see on` he looks when the conversation opens and every 90 seconds while it lasts.

### Cleanup (0.6.0)

What the day of live tests left behind is gone: the acoustic prints and DTW, the learned lone words, the "stop" prints and the walk-through's step for ordinary sentences (it only calibrated the prints). `hal_name.py` is text only (no numpy); the walk-through is "HAL, please wake up" three times, "HAL, go to sleep" three times, the result. Its steps are called `wake` and `sleep` everywhere. The ears' text side has tests (`tests/test_ears.py`), and `tools/release.ps1` does a release in one go.

### Not always heard (0.6.1)

The owner: "please wake up" was not always heard, and the first word often fell away. Microphone segments now start 0.3 s earlier (the VAD opens late); a wake or sleep sentence survives a wrong language label; "please wake up" during an open conversation gets a spoken "I am already here." instead of a silent look; and `/hal check` counts the microphone segments thrown away in the last ten minutes, with why (another language, noise), never the words.

### The eye comes back, and stays in front (0.6.2)

A second "please wake up" soon after "stop" opened a conversation without an eye: the host queued the eye only when idle, and his closing line and its slow exit were still running. The eye and his first words are now always queued (after whatever plays) and never dropped as late. While he is on screen, the host puts the haze windows back on top every 1.5 s (SetWindowPos HWND_TOPMOST, no move, no size, no activation): another topmost window can no longer push him down.

### Only the first haze ever appeared (0.6.4)

The real reason the eye did not come back (0.6.2 and 0.6.3 fixed neighbours of it): WPF refused to show a hidden haze window that was still maximised ("Cannot show Window when ShowActivated is false and WindowState is set to Maximized"), so every haze after the first of a session failed with an error the mod only logged. Found by driving a copy of the host, with its own mutex and inbox, through open, close and reopen. The window is set to Normal before it is shown and maximised after. Probably also why the owner saw no eye on the laptop in the morning. The sleep sentence also accepts "ga slapen" and "ga te sleepen".

### Step 10: HAL sees (built; live test open; owner decision 2026-11-18)

The best experience is with a webcam and a microphone.

- [x] `/hal see on|off`, off by default. One look when HAL's process is this session's (on waking) and when switched on, then at most every 20 minutes while the guest was active in the last 10; only the session that owns the process looks; never during a call.
- [x] `assets/hal-sight.py`: OpenCV (headless) opens the camera for about a second, lets the exposure settle, measures the last frame and releases the camera. YuNet (score ≥ 0.8) counts faces; the nearest face's width gives the distance, its centre the side (mirrored, as the guest sees it); mean brightness, red against blue for lamp light or daylight, and backlight. Only JSON numbers leave the process; the frame is never on disk.
- [x] `hooks/sight.ts`: the last two looks become facts in the fact block ("one face, very close to the screen; dim warm lamp light"), plus what changed ("At 21:00 the guest was alone", "The room was brighter at 21:00"). Other people are only "someone else". `/hal check` shows the last look.
- *Deviation:* the plan sent the frame to the model. `$.model.complete` takes text only in this build, and seeing locally keeps every pixel on the machine, as the ears keep every sound.
- [ ] *Live test* with the camera: is "close", "left" and "lamp light" right on the laptop's camera? Is a second face found at a desk?

### Smaller leftovers

- [ ] Render the final phrase at speed 0.85, if a listening test approves.
- [ ] Try `prompt.context` for the character instead of resending it (a test must show user mods may use it).

