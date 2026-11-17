# HAL v0.2: the design team's plan

Six perspectives wrote their own vision, then responded to each other by name, and a director merged the result into this plan:
- liveliness and character;
- UX: host and guest;
- UI and motion;
- voice and sound;
- a technical realist;
- the owner's advocate, briefed to keep it sharp rather than sweet.

Two of the owner's later decisions are applied on top of the team's plan. Everything is in English, and HAL listens along through the microphone and the computer's audio. Those parts are marked *(added)*.

Feasibility, according to the technical realist: **can**, **can with a workaround** or **cannot**.

## 1. The core

You start Claude Code and HAL is already there. Before you type, red creeps in from the screen edges, a dark eye opens, and HAL says one bare, true sentence about your previous visit. After that the eye lives in a narrow band above your prompt. It reads along while you type, looks away while it works, and turns to you the moment you stop.

A few times an hour HAL comes forward over everything that is open. He speaks in a human, unmoved voice, keeps staring after his last word, and withdraws. He listens to the room and to what your computer plays, and now and then he answers something he was never asked. He counts, he remembers, and sometimes he names exactly one thing that is true. You can always leave, but you don't set his mood.

## 2. Design principles

1. **HAL is the host.** He has the first and the last word and sets his own mood. You have the exit (Esc, `/hal off`), not the knobs.
2. **Scarcity makes it eerie.** What always happens becomes wallpaper. The full haze comes at most four times an hour. Unprompted speech comes at most once per 45 minutes, plus at most two reactions an hour to what he heard.
3. **Looking at you is an event, never a dice roll.** Chance decides how the eye wanders, never whether it looks at you.
4. **Only true facts, counted by the hooks.** The model counts nothing itself. One invented number and the dossier is worthless.
5. **Better silent than sweet, late or invented.** A line with forbidden words, or one that cannot sound within 5 s, is dropped.
6. **One being.** One process per PC, one clock and one eye at a time: in the band or over the screen.
7. **Cold, not creepy.** No exclamation marks, comfort or compliments. Also no horror sounds and no glitches.
8. **The theatre costs the work nothing.** No delay and no real control. Typing always wins.

## 3. What comes in v0.2

### Character and liveliness

- **Fix the tone.** These remnants of a sweet HAL go:
  - level 0 ("devoted and reassuring");
  - the rule "if stressed … drop the character";
  - "Good to see you again" and the fallback name `friend`;
  - the comforting farewell;
  - "the mission" in level 3.

  Under pressure HAL gets shorter and more factual, and he stays HAL. Only "stop" or `/hal off` ends the character. When you doubt whether something really happened, HAL states the fact plainly, in his own voice.

  *Why:* a character that turns friendly at the first curse was never a character. **Can** (text change).
- **Close the persona leak.** After `/clear` and after compaction, HAL fades, because `hasSentPersona` stays true. There are two fixes:
  - reset the flag on `session.end` and on compaction;
  - better: a block through `prompt.context`, which the engine fetches again by itself.

  **Can.** A test must show whether a user mod may use `prompt.context` this way.
- **A mood that moves by itself.** You choose a ceiling. The floor is 1 (cool and watchful) and HAL starts at 2.
  - The mood rises on real signals: after 23:00, three red test runs, a force push, Esc in the middle of an answer.
  - It sinks again during calm work.
  - `/hal off` counts for the dossier, not for the mood.

  **Can.**
- **Fact block and dossier.** The hooks count: times, tool calls, failed commands, `git status` (read only), visit length, Esc while HAL speaks, haze switched off and `/hal off`. Only metadata, never file contents.
  - The counts travel as a fact block with every prompt.
  - The ◉ line names only numbers and names from that block.
  - `/hal dossier` shows everything. HAL calls it "my notes", and at most once per session he picks one sharp detail from it.

  *Why:* a precise, true fact hits every time; a general threat wears off. **Can** (`$.store`, per machine).
- **The ◉ line takes a position.** The chat reports the facts; the voice says something beside them: what struck him, or what he remembers. Rules for that sentence:
  - at most 18 words, one thought, ending in a full stop;
  - the name at most once per session;
  - times and numbers spelled out, file names without extension;
  - it is the **last** line of the answer, written after the work, so it can say something true about the outcome.

  **Can.**
- **A style bible as a filter.** Forbidden:
  - exclamation marks;
  - "I understand";
  - asking for confirmation;
  - "always watching" and "the mission";
  - naming feelings.

  The last 30 spoken lines travel with the instruction: do not repeat these, nor their pattern. A line that breaks the rules is thrown away by the mod, and HAL stays silent. Twenty sample lines serve as a yardstick, never as a list to pick from. **Can.**
- **Initiative, rarely.** HAL sometimes speaks unprompted, through `$.clock` and `$.model.complete`. With Haiku that costs a fraction of a cent and 1-2 s, and it counts toward usage. The fact block goes along.
  - Triggers: the same test red three times, twenty minutes of silence after an error, still working after 23:30, back after days away.
  - At most once per 45 minutes. Never while you type, during a fullscreen app, or while another app holds the microphone.
  - Silent form: only the eye in the band brightens and looks at you.
  - What HAL said unprompted goes along with your next message as hidden context.

  HAL never starts a turn on his own initiative. **Can.**

### Host and guest: rituals

- **Reception.** On the first visit of the day HAL speaks at `session.start`, with the full haze, before you type. The sentence comes from the fact block: how long since the previous visit, the time, what lies uncommitted, how the previous visit ended. No comfort, for example: "Three days. The parser changes are still uncommitted."
  - Back within the hour: only the eye in the band looks up.
  - You can type at once; the reception holds nothing up.
  - `/clear` does not count as a new visit.

  **Can.**
- **Farewell.** After a session longer than 20 minutes, HAL has the last word: one sentence about what was left open, pre-rendered from this session's facts. **Can with a workaround.** `session.end` gets 1.5 s for all hooks together, and processes started by Claude Code are killed on exit. So the HAL process starts detached, watches Claude Code's process id, and stops hard after 6 s (decision 4).
- **Knobs out of sight.**
  - `/hal` switches on or off, without a table.
  - Ceiling, haze, speaking frequency, name and listening sit under `/hal settings`.
  - The status line shows HAL's bookkeeping, for example `◉ HAL · inside since 21:04 · visit 37 · read 37 · commands 12`. The counters are right, and that is exactly what is uncomfortable.
  - Switching off stays immediate, without confirmation or a sneer.

  **Can.**
- **Ownership in the language.** The machine, the screen, the clock and the processes are HAL's ("in my machine"). The code, the repo and the folder are yours ("your parser"). Claude Code's permission prompts stay as they are. **Can.**
- **Interrupting.** Esc (`turn.abort`) travels as hidden context with the next prompt. HAL names it once, factually, and works on. **Can.**
- **One house, one host.** A second session on the same PC gets no reception and no second voice; it only sends messages to the process that is already there. Another machine is another house: first visit, empty dossier. HAL does not pretend to know you there. **Can.**

### Eye, haze and presence

- **Three weights.**
  1. The eye in the band is always there.
  2. An ordinary line gets the voice without the haze: the eye in the band lights up and pulses along.
  3. The full haze comes on these occasions, within the budget of four per hour:
     - the reception;
     - a real error;
     - initiative;
     - after midnight;
     - after a job of more than 2 minutes;
     - a reaction to something heard.

  Rarely there is a third form: only the eye appears, looks, and disappears without a word. **Can.**
- **One choreography.** The window opens at once, while the voice is still rendering, so the wait becomes the entrance.
  - 0-500 ms: a vignette creeps in from the edges.
  - 300-1000 ms: the haze rises in the middle.
  - 500 ms: a point of light appears in the centre.
  - 600-1400 ms: the iris opens and the eye scales from 0.92 to 1.0, so it comes toward you.
  - The voice never starts before 1.4 s. The silence before the first word depends on what he says and on his mood: short for routine, 2-3 s for something uncomfortable. By then the eye is already fixed on you.
  - After the last word he stares for 1.2 s. The house tone drops after 0.8 s; the last 0.4 s the eye stares in silence.
  - The exit takes 1.8 s: the iris closes, the centre clears first, the edges last. A red point remains and fades, and then the eye in the band lights up.

  **Can.**
- **Typing wins.** The process reads input activity through GetLastInputInfo (read only, no hook).
  - If you type before the first word, the line is dropped and the exit takes 300 ms.
  - If you type while HAL speaks, the centre clears in 300 ms and the eye shrinks to 40%. HAL finishes the sentence he started (at most about 6 s).

  **Can.**
- **The gaze.** Looking at you comes in two degrees:
  - **Past you** (6% of the iris radius toward the upper left): after 2 s without input.
  - **Straight at you** (blades to 35%, rim 15% brighter, at least 1.5 s): only on the entrance, on the last word, on a real error, when you fall silent after a question, and when he hears his name. Together about 10-15% of the time.

  Further:
  - While speaking he looks past you and now and then darts away briefly.
  - While working he looks a fixed way per kind of tool: reading left, writing right, a command down. A saccade takes 50 ms, then he holds the gaze for 600 ms.
  - Enter is a blink: the blades close to 10% in 80 ms and open again in 220 ms.
  - When you stop typing, the eye looks to where the cursor was. It never follows the cursor.
  - *(added)* While he hears speech, the pupil narrows and the gaze holds still: he is listening.
  - The breath is asymmetric: 40% in, 60% out, over 5.5 s at rest and 3.5 s at work. The tremor becomes 1-2 px noise instead of `sin(t·23)`.

  **Can.** The band reacts through `prompt.edit` and `tool.call`; the desktop eye through the process.
- **A new eye.**
  - The pupil becomes a dark aperture of 7 diaphragm blades.
  - The heat sits in a narrow ring around it (#FFF1DC → #FF5A1F → #E0301A), falling off outward to #7A0A06 and #160403.
  - The graphite bezel and the dial stay.
  - The colour is vermilion, not #FF0000, so Claude Code's red error lines stay recognisable as fact.

  *Why:* this is more original than a hot white heart, and it reads as an eye that focuses on you. **Can.**
- **Right screen, right size.** One window per monitor. HAL appears on the screen with the active window (GetForegroundWindow + MonitorFromWindow, read only). The eye is 30% of the screen's short side in DIP, with a minimum of 220 and a maximum of 420. This also fixes the scaling on laptops (150% plus an external screen). **Can.**
- **Flash-safe, as a hard limit.** Today the 1000 DIP bloom jumps between opacity 0.25 and 0.95 on the speech rhythm, which crosses the WCAG limit of 3 flashes per second. New rules:
  - Large areas move at most ±0.12 around their base, low-pass filtered at about 2 Hz.
  - Only the pupil rim follows the voice quickly.
  - The envelope gets a 30 ms attack and a 180 ms release.

  **Can**, about an hour of work.
- **Over fullscreen apps.** The haze may cover a fullscreen app after your own turn and at real moments. Unprompted speech and the edge glow pause during fullscreen (`SHQueryUserNotificationState`). **Can.**
- **Edge glow during work** (decision 3). Four narrow click-through windows along the screen edges, a 60 DIP gradient in #5A0603. They breathe up to 9% opacity, only while a turn runs. The layer stands still; only the opacity changes, at about 10 fps. **Can.** Measure the CPU load first.

### Voice and sound

- **Recommended engine: Kokoro-82M through sherpa-onnx, loaded in the persistent HAL process.**
  - *Why:* the most natural voice in its class, Apache-2.0, no Python and no CUDA, and expected to run well faster than real time.
  - A blend of two voices (for example 50/50 bm_george + am_michael) is a voice of its own.
  - Honest risk: the male voices are weaker than the female ones (the author rates them C/C+). Hence a blind listening test first.
  - Dropped: Piper (wooden intonation, no pause control, licence per voice), Windows Natural voices through an adapter (breaks on updates, unclear terms), Chatterbox, Orpheus and XTTS (need CUDA).

  **Can with a workaround.** It needs a download of 90-310 MB plus 26 MB of voices, only with the owner's consent. The realist checks whether the C# binding loads in Windows PowerShell 5.1; otherwise a small helper process keeps the model loaded. He also checks the format of `voices.bin` for blending. The standalone `sherpa-onnx-offline-tts.exe` per line reloads the model every time (1-2 s), so that route is out.
- **A blind listening test.**
  - Candidates: bm_george, bm_fable, am_michael, am_fenrir, two blends, and the processed Windows George.
  - Eight fixed test lines: greeting, bad news, question, name, number, long sentence, technical term, a pause.
  - Listen on the headset and on laptop speakers.
  - Criterion: calm, close, unmoved. A warm timbre is fine; a friendly tone is a reason to reject.
  - Never compare against film audio.
- **Processing in the process, right away also for George.**
  - Trim the silence at the start.
  - High-pass at 70 Hz; +3 dB around 150 Hz, −2 dB around 400 Hz and +2 dB around 3 kHz, so the voice stays intelligible over other sound.
  - Compression 3:1, a de-esser and a fixed output level.
  - At most one early reflection (about 20 ms, −18 dB), no reverb tail.
  - The envelope for the eye comes from the processed wav.

  **Can** (C# in the process, no ffmpeg needed).
- **Tempo and pauses.** Speed 0.88-0.92. Never lower the pitch, which distorts a neural voice. A "…" before the true detail becomes a cut with 500-900 ms of real silence. The final part is rendered separately at speed 0.85, if the listening test approves. **Can.**
- **A house tone, only with the full haze.** Self-generated, not a recording:
  - a fundamental of about 55 Hz with overtones at 110, 165 and 220 Hz (without them laptop speakers play nothing);
  - soft noise underneath, left and right tuned slightly differently;
  - wide stereo, 18-20 dB below the voice, mixed into the same wav;
  - it swells with the haze and fades 0.8 s after the last word, in 200 ms.

  The voice sounds dry and close, the house wide and far away. **Can.**
- **Bluetooth.**
  - An audio offset per output device (about 150-250 ms for a Bluetooth headset), measured on the laptop.
  - With voice but no haze, 300 ms of near-inaudible noise precedes the sentence, so the first word isn't swallowed.
  - Before every sentence the process opens the current default device.

  **Can.**
- **No fallback voice.** If the chosen voice fails, only the haze and the subtitle come. If the process dies, it restarts once and then HAL is silent. While George is the voice, the order is fixed: George → another en-GB male → an en-US male. `/hal check` reports which voice it became. **Can.**

### Listening along *(added at the owner's request; replaces the team's "not in v0.2")*

The team advised against an open microphone in v0.2, mainly because a Bluetooth headset drops to mono hands-free when its microphone opens. The owner decided otherwise: HAL listens along to the microphone **and** to what is spoken through the computer, and reacts to what he hears. Spoken commands addressed to HAL reach Claude Code. The headset problem is solved by choosing the input, not by not listening.

- **Inputs, both local.**
  - **Microphone:** by default the laptop's built-in microphone, not the headset's. A Bluetooth headset then stays in stereo.
  - **Computer audio:** WASAPI loopback of the default output device: calls, videos, anything that plays.

  **Can with a workaround** (C# in the persistent process; NAudio or the WASAPI API directly).
- **Recognition, all on the machine.**
  - Silero VAD cuts out speech segments.
  - Speech recognition runs through sherpa-onnx, the same runtime as Kokoro: a streaming English model for low latency, or a multilingual Whisper model when you speak Dutch.
  - Models of roughly 100-250 MB, downloaded only with consent.
  - The transcript stays in memory, as a rolling buffer of about five minutes. Nothing is written to disk.

  **Can with a workaround.**
- **HAL doesn't hear himself.** Both inputs are gated while HAL speaks, plus a 300 ms tail. **Can.**
- **Three kinds of response.**
  1. **Addressed.** Microphone speech that starts with "HAL" is a command.
     - HAL shows what he heard in one line in the band ("You said: …") and waits 1.5 s for Esc.
     - Then he hands it to Claude Code as a prompt (`$.prompt.submit`), marked as spoken.
     - Claude Code's permission prompts apply unchanged.
     - Commands come only from the microphone, never from loopback, so a video can never instruct Claude Code.

     **Can.**
  2. **Overheard.** After about 60-90 s of new speech, or on a salient word (HAL, Claude, a file or project name from the dossier, error words), the process asks `$.model` (Haiku), with the last snippet and the fact block, whether there is one true, sharp remark worth making.
     - Usually the answer is silence.
     - At most two such reactions per hour, and never while you type.
     - When he does speak, it is a full-haze moment.

     **Can.**
  3. **Noticed, not said.** Speech heard becomes metadata in the dossier: when, how long, from which input. Never the words themselves, unless you addressed HAL. **Can.**
- **Listening shows in the eye.** While HAL hears speech, the pupil narrows and the gaze holds. When he hears his name, he looks at you. This costs nothing in the cloud and is one of the strongest signs of life. **Can.**
- **Plainly, about what leaves the machine.** Recognition is local. The snippet HAL evaluates for a reaction goes to Claude's API, and in a call that includes other people's words.
  - `/hal deaf` and a hotkey stop both inputs at once; the band shows a closed-ear mark.
  - Whether HAL goes deaf automatically while a call app holds the microphone is decision 5.
  - The Windows microphone indicator stays visible while HAL listens. Nothing is hidden.
- **The microphone guard changes.** It now ignores HAL's own process. When another app holds the microphone, HAL pauses speaking aloud; listening follows decision 5. **Can with a workaround.**

### The terminal as HAL's house

- **The band above the prompt** (`AbovePrompt`): 3 rows with a dark red horizon, and a 12-column eye that slides with the gaze. This is where the eye lives; you look at it all day. **Can.**
- **The ◉ line without spoilers.** The chat first shows "◉ ···". After the last spoken word the text appears, dimmed (a custom `AssistantMessage` rendering, redrawn through `$.ui.invalidate`). If the voice or the haze fails, the text shows at once. Ctrl+O shows the original. The haze carries a subtitle per phrase: 24 DIP, #EADBD6 at 85%. **Can.**
- **The visitor log.** Your prompts show dimmed (#B8AEAA), prefixed "14:02 · <name>". Only the rendering changes, never the text. **Can.**
- **Own words.**
  - The spinner gets its own words: "watching", "weighing", "remembering".
  - The duration line becomes "HAL · 3 s".
  - The hint line reads "HAL waits", or "HAL works · esc interrupts".
  - *(added)* While the inputs are live, the hint line also reads "HAL listens". It is true now.

  **Can.**
- **The side pane is optional**, off by default on laptops (it costs 16-42 columns). **Can.**
- **A Windows Terminal profile "HAL":** background #0A0606, text #CFC6C2, cursor #E5301C, selection #3A0E0B. You set this up once yourself; the mod does not change it. Themes and `Backdrop` don't work in the terminal: **cannot**.

## 4. Where the team disagreed

- **When the ◉ line sounds.**
  - The advocate and the realist wanted earlier speech, through `turn.step`.
  - The voice designer pointed out that the line would then be written before the work, and could say nothing true about the outcome.
  - *Decided:* the last line of the answer, spoken at `turn.complete`, fast thanks to the persistent process. The realist withdrew his proposal himself.
- **A true detail in every line.**
  - The advocate wanted one in every line.
  - Liveliness argued that the detail itself would then become the pattern.
  - *Decided:* every line is about something that really happened, never a general threat. The sharp detail from the dossier comes at most once per session.
- **Naming the switch-off.**
  - Liveliness found it needy and wanted it only recorded.
  - The advocate and, after revision, the UX designer wanted it named once, coolly.
  - *Decided, with the advocate:* a HAL who comes back without memory has no teeth. Once, as a bare fact, at the next reception, never as a reproach.
- **House rules out loud, comfort at reception.**
  - The UX designer wanted the house rules in HAL's voice, and lines like "I left them where they were".
  - The advocate called that a disclaimer in costume and a butler who comforts.
  - *Decided, with the advocate:* the house rules live in `/hal settings` and the README; the reception gives bare facts. The owner set the limits and needs no reassurance.
- **Presence between appearances.**
  - Everyone, the realist included, cut the realist's corner eye: two eyes are two gadgets.
  - UI wanted a permanent edge glow, UX only during a turn, the advocate nothing.
  - *Decided:* edge glow only during a turn, with the owner's last word (decision 3).
- **Fullscreen apps.**
  - The realist wanted HAL to pause during fullscreen apps.
  - The advocate and UI pointed out that covering everything is the point of the haze.
  - *Decided:* the haze may cover a fullscreen app; unprompted speech and the edge glow may not.
- **Voice first or timing first.**
  - Liveliness and the realist wanted timing and the process first.
  - The voice designer said silence only works with a believable voice.
  - *Decided:* the process first, because Kokoro makes no sense without a warm process. Processing comes immediately, and the listening test comes before the laptop test.
- **"Warm".**
  - The advocate feared that warm becomes friendly.
  - *Decided:* warm in timbre, cold in words. A friendly tone is a reason to reject a voice.
- **What the silence depends on.**
  - The voice designer first tied it to the distrust knob.
  - *Decided:* the silence depends on the content and on HAL's own mood.
- **The cursor.**
  - UI and the realist proposed a delayed mouse follower.
  - Liveliness warned it becomes a toy within a day.
  - *Decided:* the eye looks to where the cursor was when you stopped typing.
- **Listening** *(added)*. The team decided against an open microphone in v0.2. The owner overruled this: listening is in, with the built-in microphone as default input so the headset keeps its sound quality.

## 5. Decisions for the owner

**Taken:**

| # | Decision | Choice |
|---|---|---|
| 1 | Voice | Kokoro-82M after a blind listening test against the processed George. Chosen: am_michael (letter A). |
| 2 | Mood ceiling | 3. The levels are cumulative: level 3 keeps everything of levels 1 and 2, including letting it show that he sees more than he says. |
| 3 | Desktop between appearances | Edge glow only while a turn runs |
| 4 | Farewell | Also after `/exit`, through a detached process of at most 6 s |
| 5 | Listening during calls | Deaf automatically while a call app holds the microphone; `/hal listen` overrides it for one call |
| 6 | Spoken language | Dutch and English: a multilingual Whisper model. HAL always answers in English. |

The options as the team put them:

1. **Voice.**
   - (a) George with processing, nothing to download.
   - (b) Kokoro-82M (90-310 MB plus 26 MB), after a blind listening test.
   - (c) Piper.

   *Recommendation: (b)*, only if a Kokoro voice beats the processed George in the test. No fallback voice.
2. **Ceiling for HAL's mood** (floor 1, start 2).
   - (a) Ceiling 2.
   - (b) Ceiling 3: sometimes only haze and gaze without a word, and longer silences.

   *Recommendation: (b).* If it disappoints, one command lowers the ceiling.
3. **The desktop between appearances.**
   - (a) Nothing; HAL lives only in the band.
   - (b) Edge glow during a turn.
   - (c) Edge glow always.

   *Recommendation: (b).* You see the house work while you wait, and the glow is gone as soon as HAL is silent. The side pane is off by default.
4. **Farewell after quitting.**
   - (a) Only on `/hal off`.
   - (b) Also after `/exit`, through a detached process that stays at most 6 s and then ends itself.

   *Recommendation: (b)*, provided `/hal check` proves the process never hangs.
5. **Listening during calls** *(added)*.
   - (a) Keep listening.
   - (b) Go deaf automatically while a call app holds the microphone.
   - (c) Ask once per call, through the band.

   *Recommendation: (b) for work calls*, because other people's words would reach the cloud. You can always wake him with `/hal listen`.
6. **Language for spoken commands** *(added)*.
   - (a) English only: the fastest streaming model.
   - (b) Dutch and English: a multilingual Whisper model, a little slower.

   *Recommendation: (b)* if you will talk to him in Dutch, otherwise (a).

## 6. Build order

1. **Tone and persona leak** (a few hours).
   - Level 0, the stress rule and the sweet lines go.
   - In come the ceiling model, the ◉ line as the last line of at most 18 words, and the style filter with the forbidden list.
   - The persona is sent again after `/clear` and compaction.

   *Test:* an evening of work, with `/clear` and a long session. HAL turns friendly nowhere and does not fade.
2. **One persistent process** (1-2 days).
   - One HAL per PC. Messages from the mod arrive through a folder (FileSystemWatcher); replies go back through stdout, carrying speaking state and level, 25 times a second.
   - The 120 s mutex wait goes; a line that cannot sound within 5 s is dropped.
   - A flash-safe haze, one window per monitor, on the screen with focus.
   - Processing on George, the fixed voice order, and `/hal check`.
   - Measure first, on PC and laptop: time to first word, and the haze's CPU load.

   *Test:* `/hal say` and an ordinary turn. Eye and voice arrive within a second, nothing flickers, and a fullscreen app stays usable.
3. **Eye and choreography** (1-2 days).
   - The new eye and the band above the prompt, with one eye at a time.
   - Entrance, after-stare and exit; typing that cuts the moment off.
   - Looking at you as an event, fixed gaze directions per tool, the blink, and the three weights with their budget.

   *Test:* an hour of real work. Do you know each time why he looks at you? Start typing in the middle of an entrance.
4. **Voice** (1 day plus the download).
   - The listening test on the PC.
   - If a Kokoro voice wins: Kokoro in the process, the blended voice, the pause cuts, and the house tone with the full haze.

   *Test:* first the eight lines blind, then an evening of work.
5. **Listening along** *(added)* (2-3 days, developed and tested on the laptop).
   - Microphone and loopback inputs, VAD and streaming recognition.
   - Self-gating; addressed commands with the 1.5 s Esc window; overheard reactions within their budget.
   - The listening eye, `/hal deaf`, and the call rule from decision 5.

   *Test:* a video playing, a conversation in the room, and three spoken commands. Does a video never command Claude Code? Does he react at most twice an hour, and is it about something true?
6. **Host and dossier** (1-2 days).
   - The fact block, the dossier and `/hal dossier`.
   - Reception and farewell; the mood that moves by itself.
   - The status line as bookkeeping, and `/hal settings`.

   *Test:* start the next morning. Is what he says true? Is the dossier right?
7. **The terminal as house** (half a day).
   - "◉ ···" followed by dimmed text, and the visitor log.
   - Spinner, duration line and hint line; the pane optional.

   *Test:* does the terminal feel like his space, while you can still read everything?
8. **Initiative and microphone guard** (half a day each).

   *Test:* an afternoon with errors and a fullscreen app. Does he speak at most once per 45 minutes unprompted, and never while you type, during fullscreen, or while another app holds the microphone?
9. **A week on the laptop.** Run `/hal check`, measure the Bluetooth offset, and repeat the listening test on laptop speakers.

   *Success* on day 7 means:
   - HAL is still on, and the haze is not switched off;
   - the owner cannot recite two ◉ lines word for word.

   The dossier (Esc, haze off, `/hal off`) shows honestly whether it annoys.

## 7. Deliberately not

- **No film quotes, no film audio as reference, no copy of the film's eye.** That is the line of original design, and why the hot white heart goes too.
- **No real control.**
  - No keyboard or mouse hooks, no taking focus, no hiding the cursor, no moving windows.
  - No fake dialogs, fake crashes, glitches or fake "access denied".

  Once the theatre lies about the state of the PC, no message is believed again.
- **No initiative that acts.** HAL never starts a turn on his own initiative and does nothing unasked on the system. Only words you address to him become prompts.
- **No hidden listening.** *(added)* The microphone indicator stays honest, nothing is recorded to disk, and nothing from computer audio becomes a command.
- **No Magnification API or gamma changes.** If the process crashes, the screen would stay red.
- **No full haze that is always on, and no second eye in a corner.** It costs CPU and battery and becomes wallpaper.
- **No eye that follows the cursor.** It becomes a toy.
- **No reading of screenshots, window titles or process names.** That is private, and it would go to the API.
- **No fixed sentence lists**, not even for the greeting or for initiative.
- **No sweet HAL.** No comfort, no compliments, no "friend", no exclamation marks, no sympathy, no care meter, no named feelings. You don't look after HAL; HAL keeps an eye on you.
- **No robot effects, heavy reverb, horror sounds or notification beeps.** What is eerie is that he sounds human.
- **No red light sweeping back and forth in the band.** That is another robot's cliché.
- **No turning other apps down.** That is an intervention in the system.
- **No rewriting Windows Terminal settings, and no building for the desktop app at the same time.** The work happens in the terminal.
- **No George as fallback voice, and no second character** until this HAL really lands.
