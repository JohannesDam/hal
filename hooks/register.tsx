import { atom, read, update } from 'claude-code'
import type { EngineInterface, Register } from 'claude-code'

import type { HalLevel, HalMood, HalSettings } from '../types'
import {
  beginVisit,
  bookkeeping,
  describeDossier,
  endVisit,
  factBlock,
  localDay,
  localTime,
  parseGit,
  readDossier,
  receptionKind,
} from './dossier'
import type { Dossier, Git, Moment, Visit } from './dossier'
import { acknowledgement, addressed, ATTEND_MS, hearsName, isSalient, keep, remarkFrom, shouldWeigh, tally, weighRequest } from './ears'
import type { Heard, HeardTally, ReflectState, Source } from './ears'
import { advance, bandFor, HOW_TO_CALL, LEARN_INTRO, learnedNote, lineFor, PRACTICE_MS, STEP_TIMEOUT_MS } from './learn'
import type { Learn, Learned } from './learn'
import { LOOK_EVERY_MS, parseSeen, sightFacts } from './sight'
import type { Seen } from './sight'
import { bandCells, eyeCells } from './eye'
import { lookFrom, newGazeState, stepGazeState, toolKind } from './gaze'
import type { Attention, ToolKind } from './gaze'
import { INITIATIVE_GAP_MS, initiative, momentRequest, newWatch, noteTest, testKey } from './moments'
import type { Occasion, Watch } from './moments'
import { isForcePush, isLateHour, moodLevel, moveMood, returnMood } from './mood'
import type { MoodEvent } from './mood'
import {
  DEFAULTS,
  HELP,
  OFF_NOTE,
  SPOKEN,
  cleanSpokenLine,
  describe,
  describeCheck,
  judgeLine,
  lastSpokenLine,
  mentionsName,
  migrate,
  parseCommand,
  persona,
  reminder,
  speakable,
  testLine,
} from './persona'

const PANE = 'hal-eye'
const FRAME_MS = 50
const RECENT_MAX = 30
const HAZE_PER_HOUR = 4
const HOUR_MS = 3_600_000

// Change the shape tag when the settings' fields change: a value stored under
// another tag is read as the initial value, and load() migrates the store.
const settingsAtom = atom({ plugin: 'hal', key: 'settings' } as const, DEFAULTS, {
  shape: 'settings-6',
})
const moodAtom = atom({ plugin: 'hal', key: 'mood' } as const, 'idle' as HalMood)
const levelAtom = atom({ plugin: 'hal', key: 'level' } as const, 2 as HalLevel)
const lineAtom = atom({ plugin: 'hal', key: 'line' } as const, '')
const earsAtom = atom({ plugin: 'hal', key: 'ears' } as const, 'off')
const saidAtom = atom({ plugin: 'hal', key: 'said' } as const, '')
/** Counts up when a spoken line may be shown in the chat: the chat redraws it. */
const revealAtom = atom({ plugin: 'hal', key: 'reveal' } as const, 0)
/** The session this visit belongs to: a reload of the mod is not a new visit. */
const visitAtom = atom({ plugin: 'hal', key: 'visit' } as const, '')

type $ = EngineInterface

// Module values: rebuilt on a reload; what must survive lives in $.state and $.store.
let timer: { cancel: () => void } | undefined
let frame = 0
let clock = 0
let gaze = newGazeState()
let mounted: { columns: number; rows: number } | undefined
let band: { requestId: string; columns: number } | undefined
let mood: HalMood = 'idle'
let hasSentPersona = false
let moodScore = 2
let isNameUsed = false
let hadFailureThisTurn = false
/** The turn's last tool call failed: an error that stayed an error. */
let lastToolFailed = false
let hadForcePushThisTurn = false
let recent: string[] = []
let hazeTimes: number[] = []
let utcOffsetMinutes: number | undefined

// What the eye knows (times on `clock`).
let lastEditAt = -Infinity
let submitAt = -Infinity
let toolAt = -Infinity
let lastToolKind: ToolKind = 'other'
let atYouUntil = -Infinity
/** True while the full haze holds the screen: then the band's eye is closed. One eye at a time. */
let isAway = false

// Listening along (ears.ts). The words stay in this module's memory, five minutes at most.
let heard: Heard[] = []
let hearing: Record<Source, boolean> = { mic: false, loop: false }
let isDeaf = false
let reflect: ReflectState = { newSec: 0, lastWeighedAt: -Infinity, remarks: [] }
let isWeighing = false
let isAddressing = false
/** After his name alone: until when the next microphone sentence is a command (wall clock). */
let attendUntil = -Infinity
/** The acknowledgement on its way; the window starts again once he has finished saying it. */
let ackId: string | undefined
let lastAck: string | undefined
/** /hal learn in progress (learn.ts); undefined otherwise. */
let learning: Learn | undefined
let learnSerial = 0
// /hal see (sight.ts): the last two looks, as numbers. Only in this module's memory.
let seen: Seen | undefined
let seenBefore: Seen | undefined
let lastLookAt = -Infinity
let isLooking = false
let saidSerial = 0
/** The prompt HAL is about to send for you, as you spoke it. */
let spokenPrompt: string | undefined
/** What the model must know with the next prompt: what HAL said unprompted. */
let notes: string[] = []
let projectName = ''

// The host's notes (dossier.ts) and what HAL watches for his own initiative (moments.ts).
let dossier: Dossier | undefined
let visitId = ''
let git: Git
let watch: Watch = newWatch()
let watchTimer: { cancel: () => void } | undefined
/** A fullscreen app; another app holding the microphone (then HAL does not speak aloud). */
let desk = { fullscreen: false, micBusy: false }
/** Decided at session.start, done once HAL's process is ours: one house, one host. */
let pendingReception: 'full' | 'look' | undefined
let farewellAt = -Infinity
let isFarewellBusy = false
/** One sharp detail from the notes, at most once per session. */
let isDetailUsed = false

// The terminal as HAL's house (step 7). A spoken line shows as "◉ ···" until it has been said.
const pendingLines = new Set<string>()
const revealedLines = new Set<string>()
const sayLines = new Map<string, string>()
/** The say messages that took a full haze: one dropped before its first word gives it back to the budget. */
const sayHazes = new Set<string>()
/** The reception line on its way: the day counts as received once it was heard. */
let receptionSay: { id: string; line: string; tries: number } | undefined
/** When each prompt was sent, for the visitor log: rendering only, never the text. */
const promptTimes = new Map<string, string>()

// HAL's one process per PC (assets/hal-host.ps1). This session either owns it
// (and reads its stdout) or another session does (then only the inbox is shared).
let isHostRunning = false
let isHostOwner = false
let hostRestarts = 0
let lastBusyAt = -Infinity
let voiceLevel = 0
let messageCount = 0
const pending = new Map<string, (report: unknown) => void>()

async function powershell($: $): Promise<string> {
  const windows = (await $.env.get('SystemRoot')) ?? 'C:\\Windows'

  return `${windows}\\System32\\WindowsPowerShell\\v1.0\\powershell.exe`
}

async function inboxDir($: $): Promise<string> {
  const local = (await $.env.get('LOCALAPPDATA')) ?? `${(await $.env.get('USERPROFILE')) ?? 'C:'}\\AppData\\Local`

  return `${local}\\hal\\inbox`
}

async function save($: $, next: HalSettings) {
  await update($, settingsAtom, () => next)
  await $.store.set('settings', next)
}

async function load($: $): Promise<HalSettings> {
  const settings = migrate(await $.store.get('settings'))
  if (!settings.name) {
    try {
      const { stdout } = await $.process.run(['git', 'config', '--global', 'user.name'], {
        timeoutMs: 5000,
      })
      settings.name = stdout.trim().split(/\s+/)[0] ?? ''
    } catch {
      settings.name = ''
    }
  }
  const storedScore = await $.store.get('moodScore')
  moodScore = returnMood(typeof storedScore === 'number' ? storedScore : undefined, settings.ceiling)
  const storedRecent = await $.store.get('spoken')
  recent = Array.isArray(storedRecent)
    ? storedRecent.filter((x): x is string => typeof x === 'string').slice(-RECENT_MAX)
    : []
  const storedHaze = await $.store.get('hazeTimes')
  hazeTimes = Array.isArray(storedHaze) ? storedHaze.filter((x): x is number => typeof x === 'number') : []
  const storedRemarks = await $.store.get('remarks')
  reflect = {
    ...reflect,
    remarks: Array.isArray(storedRemarks) ? storedRemarks.filter((x): x is number => typeof x === 'number') : [],
  }
  isDeaf = !settings.listen
  await update($, settingsAtom, () => settings)

  return settings
}

/** The local hour; the module's own clock may not know the time zone, so Windows is asked once. */
async function localHour($: $): Promise<number> {
  const now = await $.clock.now()

  return new Date(now + (utcOffsetMinutes ?? 0) * 60_000).getUTCHours()
}

async function readUtcOffset($: $) {
  try {
    const { stdout } = await $.process.run(
      [await powershell($), '-NoProfile', '-Command', '[int][TimeZoneInfo]::Local.GetUtcOffset([DateTime]::UtcNow).TotalMinutes'],
      { timeoutMs: 15_000 },
    )
    const minutes = Number(stdout.trim())
    if (Number.isFinite(minutes)) {
      utcOffsetMinutes = minutes
    }
  } catch {
    // stays UTC; only the "late" signal depends on it
  }
}

async function currentLevel($: $, settings: HalSettings): Promise<HalLevel> {
  return moodLevel(moodScore, settings.ceiling, isLateHour(await localHour($)))
}

async function shiftMood($: $, event: MoodEvent) {
  const settings = await read($, settingsAtom)
  moodScore = moveMood(moodScore, event, settings.ceiling)
  await $.store.set('moodScore', moodScore)
  const level = await currentLevel($, settings)
  await update($, levelAtom, () => level)
  if (settings.isOn) {
    await showStatus($)
  }
}

async function setMood($: $, next: HalMood) {
  mood = next
  if (next !== 'speaking') {
    voiceLevel = 0
  }
  await update($, moodAtom, () => next)
}

/** He looks straight at you for a moment: the last word, a real error, the reception. */
function lookAtYou(ms = 1500) {
  atYouUntil = Math.max(atYouUntil, clock + ms)
}

function attention(): Attention {
  return {
    now: clock,
    mood,
    voice: isHostOwner ? voiceLevel : mood === 'speaking' ? 0.5 : 0,
    lastEditAt,
    submitAt,
    toolAt,
    toolKind: lastToolKind,
    atYouUntil,
    isHearing: hearing.mic || hearing.loop,
  }
}

async function tick($: $) {
  clock += FRAME_MS
  frame += 1
  const a = attention()
  gaze = stepGazeState(gaze, a, Math.random)
  const look = lookFrom(gaze, a)
  if (band) {
    const { requestId, columns } = band
    const result = await $.ui.blit({ requestId, key: 'band', columns, rows: 3, cells: bandCells(columns, look, isAway, isDeaf) })
    if (result.deny) {
      band = undefined
    }
  }
  if (mounted && frame % 2 === 0) {
    const { columns, rows } = mounted
    const result = await $.ui.blit({ requestId: PANE, key: 'eye', columns, rows, cells: eyeCells(columns, rows, look) })
    if (result.deny) {
      mounted = undefined
    }
  }
}

function startEye($: $) {
  if (!timer) {
    timer = $.clock.every(FRAME_MS, () => void tick($).catch(() => undefined))
  }
}

function stopEye() {
  timer?.cancel()
  timer = undefined
  mounted = undefined
  band = undefined
}

/** One line of the HAL process's stdout. Returns 'busy' when another session owns the process. */
async function onHostLine($: $, line: string): Promise<'busy' | undefined> {
  let message: Record<string, unknown>
  try {
    message = JSON.parse(line) as Record<string, unknown>
  } catch {
    return undefined
  }
  switch (message.t) {
    case 'busy':
      // Another session's process: it received the guest already.
      pendingReception = undefined
      return 'busy'
    case 'ready':
      if (typeof message.pid === 'number') {
        isHostOwner = true
        await askEars($, await read($, settingsAtom), false)
        void lookIfDue($, true).catch(() => undefined)
        if (pendingReception) {
          const kind = pendingReception
          pendingReception = undefined
          void receive($, kind).catch(() => undefined)
        }
      }
      break
    case 'desk':
      desk = { fullscreen: message.fullscreen === true, micBusy: message.micBusy === true }
      break
    case 'rendered':
      if (message.ok !== true) {
        $.ui.log(`hal: the farewell was not rendered (${String(message.why)})`, { to: 'debug' })
      }
      break
    case 'ears': {
      const state = String(message.state)
      await update($, earsAtom, () => (state === 'deaf' && message.why === 'call' ? 'deaf: a call' : state))
      if (state !== 'listening') {
        hearing = { mic: false, loop: false }
      }
      break
    }
    case 'speech':
      if (message.src === 'mic' || message.src === 'loop') {
        hearing = { ...hearing, [message.src]: message.on === true }
      }
      break
    case 'heard':
      if ((message.src === 'mic' || message.src === 'loop') && typeof message.text === 'string') {
        await onHeard($, message.src, message.text, typeof message.sec === 'number' ? message.sec : 0, message.name === true)
      }
      break
    case 'learn':
      if (typeof message.got === 'number' && learning && message.step === learning.step) {
        await onLearnStep($, message.got)
      }
      break
    case 'learned':
      if (message.forgotten !== true) {
        await onLearned($, message as Learned)
      }
      break
    case 'enter':
      isAway = message.haze === true
      break
    case 'speaking':
      await setMood($, 'speaking')
      break
    case 'level':
      voiceLevel = typeof message.v === 'number' ? message.v : 0
      break
    case 'done':
      isAway = false
      await setMood($, 'idle')
      lookAtYou()
      if (ackId !== undefined && message.id === ackId) {
        ackId = undefined
        attendUntil = (await $.clock.now()) + ATTEND_MS
        lookAtYou(ATTEND_MS)
      }
      await reveal($, sayLines.get(String(message.id)))
      sayLines.delete(String(message.id))
      sayHazes.delete(String(message.id))
      if (receptionSay?.id === message.id) {
        receptionSay = undefined
        await markReceived($)
      }
      if (message.why === 'interrupted') {
        await touch($, v => ({ ...v, interrupted: v.interrupted + 1 }))
      }
      break
    case 'dropped':
      isAway = false
      await setMood($, 'idle')
      await reveal($, sayLines.get(String(message.id)))
      sayLines.delete(String(message.id))
      // Dropped before the first word (too late to sound, or an error): that haze was never seen.
      if (sayHazes.delete(String(message.id))) {
        hazeTimes = hazeTimes.slice(0, -1)
        await $.store.set('hazeTimes', hazeTimes)
      }
      if (receptionSay?.id === message.id) {
        void retryReception($).catch(() => undefined)
      }
      $.ui.log(`hal: a line was dropped (${String(message.why)})`, { to: 'debug' })
      break
    case 'check': {
      const answer = pending.get(String(message.id))
      answer?.(message.report)
      break
    }
    case 'error':
      $.ui.log(`hal: the HAL process reported: ${String(message.why)}`, { to: 'debug' })
      break
  }

  return undefined
}

async function runHost($: $) {
  let isBusy = false
  try {
    const stream = $.process.spawn({
      argv: [
        await powershell($),
        '-NoProfile',
        '-STA',
        '-ExecutionPolicy',
        'Bypass',
        '-WindowStyle',
        'Hidden',
        '-File',
        `${$.plugin.root}\\assets\\hal-host.ps1`,
        '-Inbox',
        await inboxDir($),
      ],
    })
    let buffer = ''
    for await (const piece of stream) {
      if (piece.stream !== 'stdout') {
        continue
      }
      buffer += piece.text
      let at = buffer.indexOf('\n')
      while (at >= 0) {
        const line = buffer.slice(0, at).trim()
        buffer = buffer.slice(at + 1)
        if (line && (await onHostLine($, line)) === 'busy') {
          isBusy = true
        }
        at = buffer.indexOf('\n')
      }
    }
  } catch (error) {
    $.ui.log(`hal: the HAL process could not run: ${String(error)}`, { to: 'debug' })
  } finally {
    isHostRunning = false
    isHostOwner = false
    isAway = false
    if (isBusy) {
      lastBusyAt = await $.clock.now()
    } else if (hostRestarts < 1 && migrate(await $.store.get('settings')).isOn) {
      // One restart; after that HAL stays silent.
      hostRestarts += 1
      startHost($)
    }
  }
}

function startHost($: $) {
  if (isHostRunning) {
    return
  }
  isHostRunning = true
  // A module that unloads mid-run (a reload, the end of a test) may find $ gone: let it go.
  void runHost($).catch(() => undefined)
}

async function ensureHost($: $) {
  if (isHostRunning) {
    return
  }
  // Another session's process was there a moment ago: its inbox is ours too.
  if ((await $.clock.now()) - lastBusyAt < 30_000) {
    return
  }
  startHost($)
}

async function send($: $, message: Record<string, unknown>) {
  const at = await $.clock.now()
  messageCount += 1
  const name = `${String(at).padStart(15, '0')}-${messageCount}.json`
  await $.fs.write(`${await inboxDir($)}\\${name}`, JSON.stringify({ ...message, at }))
}

/** At most four full hazes an hour: what always happens becomes wallpaper. */
async function takeHaze($: $): Promise<boolean> {
  const now = await $.clock.now()
  hazeTimes = hazeTimes.filter(at => now - at < HOUR_MS)
  if (hazeTimes.length >= HAZE_PER_HOUR) {
    return false
  }
  hazeTimes.push(now)
  await $.store.set('hazeTimes', hazeTimes)

  return true
}

/** Ask HAL's process to listen or not. `override`: also while another app holds the mic. */
async function askEars($: $, settings: HalSettings, override: boolean) {
  isDeaf = !settings.listen
  const on = settings.isOn && settings.listen
  if (!on) {
    hearing = { mic: false, loop: false }
  }
  await send($, { kind: 'ears', on, mic: settings.mic, override })
}

async function showSaid($: $, text: string, ms: number) {
  saidSerial += 1
  const serial = saidSerial
  await update($, saidAtom, () => text)
  if (text && ms > 0) {
    void (async () => {
      await $.clock.sleep(ms)
      if (serial === saidSerial) {
        await update($, saidAtom, () => '')
      }
    })().catch(() => undefined)
  }
}

/** The chat may show a spoken line now: said, dropped, or never to be said. */
async function reveal($: $, line: string | undefined) {
  if (line === undefined || !pendingLines.delete(line)) {
    return
  }
  revealedLines.add(line)
  await update($, revealAtom, n => n + 1)
}

/** The local date, for the dossier's tally of heard speech. */
async function today($: $): Promise<string> {
  return new Date((await $.clock.now()) + (utcOffsetMinutes ?? 0) * 60_000).toISOString().slice(0, 10)
}

// ---------- the dossier: true counts, per machine ----------

async function saveDossier($: $) {
  if (dossier) {
    await $.store.set('dossier', dossier)
  }
}

function currentVisit(): Visit | undefined {
  return dossier?.open[visitId]
}

/** Counts something in this visit and keeps it. */
async function touch($: $, change: (v: Visit) => Visit) {
  const visit = currentVisit()
  if (!dossier || !visit) {
    return
  }
  const now = await $.clock.now()
  dossier = { ...dossier, open: { ...dossier.open, [visitId]: { ...change(visit), last: now } } }
  await saveDossier($)
}

/** `git status`, read only: counts, the branch, at most three file names. Never contents. */
async function readGit($: $) {
  try {
    const { exitCode, stdout } = await $.process.run(['git', 'status', '--porcelain=v1', '--branch'], { timeoutMs: 8000 })
    git = exitCode === 0 ? parseGit(stdout) : undefined
  } catch {
    git = undefined
  }
}

async function heardToday($: $): Promise<{ mic: number; loop: number }> {
  const all = (await $.store.get('heard')) as HeardTally | undefined

  return all?.[await today($)] ?? { mic: 0, loop: 0 }
}

async function moment($: $): Promise<Moment | undefined> {
  const visit = currentVisit()
  if (!visit) {
    return undefined
  }

  return {
    now: await $.clock.now(),
    offsetMinutes: utcOffsetMinutes ?? 0,
    visit,
    git,
    heardTodaySec: await heardToday($),
    project: projectName,
  }
}

/** The fact block: what HAL may name. Never the words heard. */
async function facts($: $, level: HalLevel): Promise<string[]> {
  const m = await moment($)
  const block = dossier && m ? factBlock(dossier, m) : []
  const room = heard.filter(h => h.src === 'mic').reduce((sum, h) => sum + h.sec, 0)
  const computer = heard.filter(h => h.src === 'loop').reduce((sum, h) => sum + h.sec, 0)

  return [
    ...block,
    ...sightFacts(seen, seenBefore, at => localTime(at, utcOffsetMinutes ?? 0)),
    `HAL's mood: level ${level}.`,
    ...(room + computer > 0 ? [`Speech in the last five minutes: ${Math.round(room)} s in the room, ${Math.round(computer)} s from the computer.`] : []),
  ]
}

/** The status line as bookkeeping: `◉ HAL · inside since 21:04 · visit 37 · read 37 · commands 12`. */
async function showStatus($: $) {
  const settings = await read($, settingsAtom)
  const visit = currentVisit()
  if (!settings.isOn) {
    $.ui.status(undefined)

    return
  }
  $.ui.status(dossier && visit ? bookkeeping(dossier, visit, utcOffsetMinutes ?? 0) : '◉ HAL')
}

/** One of HAL's own lines, written by the model from the facts; undefined for silence. */
async function ownLine($: $, occasion: Occasion, why?: string): Promise<string | undefined> {
  const settings = await read($, settingsAtom)
  const level = await currentLevel($, settings)
  const offs = occasion === 'reception' ? (dossier?.offsSinceReception.length ?? 0) : 0
  const { system, prompt } = momentRequest({ occasion, why, facts: await facts($, level), recent, level, name: settings.name, offs })
  const reply = await $.model.complete({ model: 'haiku', system, prompt, maxTokens: 80, effort: 'low', timeoutMs: 20_000 })
  if (!reply.isAnswered) {
    $.ui.log(`hal: no ${occasion} line (${reply.reason})`, { to: 'debug' })

    return undefined
  }
  const line = remarkFrom(reply.text)
  if (!line) {
    return undefined
  }
  const verdict = judgeLine(line, { recent, name: settings.name, isNameUsed })
  if (!verdict.isOk) {
    $.ui.log(`hal: the ${occasion} line broke the style rules (${verdict.why})`, { to: 'debug' })

    return undefined
  }

  return line
}

/** The reception: the first visit of the day gets the full haze; later only the band's eye looks up. */
async function receive($: $, kind: 'full' | 'look') {
  const settings = await read($, settingsAtom)
  lookAtYou(1800)
  if (kind === 'look' || settings.talk === 'never' || !dossier) {
    return
  }
  const line = await ownLine($, 'reception')
  if (!line) {
    await markReceived($)

    return
  }
  await remember($, line, settings)
  notes.push(`HAL received the guest aloud at the start of this visit: "${line}". Do not repeat it.`)
  const id = await speak($, line, settings, 'moment', false)
  if (id) {
    receptionSay = { id, line, tries: 1 }
  } else {
    await markReceived($)
  }
}

/** The day counts as received, and the switch-offs as named, once the reception was heard. */
async function markReceived($: $) {
  if (!dossier) {
    return
  }
  dossier = { ...dossier, receptionDay: localDay(await $.clock.now(), utcOffsetMinutes ?? 0), offsSinceReception: [] }
  await saveDossier($)
}

/** The reception never sounded (dropped): once more at the next quiet moment (five seconds without a key, within ten minutes). */
async function retryReception($: $) {
  const pending = receptionSay
  receptionSay = undefined
  if (!pending || pending.tries >= 2) {
    await markReceived($)

    return
  }
  for (let waited = 0; waited < 10 * 60_000; waited += 2000) {
    await $.clock.sleep(2000)
    if (clock - lastEditAt > 5000 && mood === 'idle') {
      const settings = await read($, settingsAtom)
      const id = settings.isOn ? await speak($, pending.line, settings, 'moment', false) : undefined
      if (id) {
        receptionSay = { ...pending, id, tries: pending.tries + 1 }

        return
      }
      break
    }
  }
  await markReceived($)
}

/**
 * The farewell, rendered ahead after twenty minutes and again at most every three: HAL's process
 * keeps it as a wav, and a waiter outside Claude Code plays it after Claude Code has ended.
 */
async function prepareFarewell($: $) {
  const settings = await read($, settingsAtom)
  const visit = currentVisit()
  const now = await $.clock.now()
  if (!visit || isFarewellBusy || !isHostOwner || settings.talk === 'never' || now - visit.start < 20 * 60_000 || now - farewellAt < 3 * 60_000) {
    return
  }
  isFarewellBusy = true
  try {
    farewellAt = now
    const line = await ownLine($, 'farewell')
    if (line) {
      messageCount += 1
      await send($, { kind: 'render', id: `farewell-${messageCount}`, text: speakable(line), farewell: true })
    }
  } finally {
    isFarewellBusy = false
  }
}

/** Once a minute: is something true enough to say unprompted? Never more than once per 45 minutes. */
async function checkInitiative($: $) {
  const settings = await followStore($)
  const now = await $.clock.now()
  if (!settings.isOn || settings.talk === 'never' || !isHostOwner || mood !== 'idle') {
    return
  }
  if (now - watch.lastInitiativeAt < INITIATIVE_GAP_MS || clock - lastEditAt < 10_000 || desk.fullscreen || desk.micBusy) {
    return
  }
  const offset = utcOffsetMinutes ?? 0
  const local = new Date(now + offset * 60_000)
  // The night belongs to the evening it started on.
  const night = localDay(now - 4 * 3_600_000, offset)
  const found = initiative(watch, now, local.getUTCHours() * 60 + local.getUTCMinutes(), night)
  if (!found) {
    return
  }
  watch = { ...watch, ...found.mark, lastInitiativeAt: now }
  await $.store.set('initiativeAt', now)
  const line = await ownLine($, 'initiative', found.why)
  if (!line || clock - lastEditAt < 4000 || mood !== 'idle') {
    // The silent form: only the band's eye brightens and looks at you.
    lookAtYou(2500)

    return
  }
  await remember($, line, settings)
  notes.push(`HAL said aloud, unprompted, because ${found.why}: "${line}". Do not repeat it.`)
  await speak($, line, settings, 'moment', false)
}

function startWatch($: $) {
  if (!watchTimer) {
    watchTimer = $.clock.every(60_000, () => {
      void checkInitiative($).catch(() => undefined)
      void lookIfDue($).catch(() => undefined)
    })
  }
}

/**
 * One look through the webcam (/hal see on): only the session that owns HAL's process, never
 * during a call (the camera may be in it), at most every twenty minutes, and only while the
 * guest was active in the last ten. `force`: now, as when /hal see on or HAL wakes.
 */
async function lookIfDue($: $, force = false) {
  const settings = await read($, settingsAtom)
  const now = await $.clock.now()
  if (!settings.isOn || !settings.see || !isHostOwner || isLooking || desk.micBusy) {
    return
  }
  if (!force && (now - lastLookAt < LOOK_EVERY_MS || now - watch.lastActivityAt > 10 * 60_000)) {
    return
  }
  isLooking = true
  lastLookAt = now
  try {
    const local = (await $.env.get('LOCALAPPDATA')) ?? `${(await $.env.get('USERPROFILE')) ?? 'C:'}\\AppData\\Local`
    const { stdout } = await $.process.run(
      [`${local}\\hal\\venv\\Scripts\\python.exe`, '-E', '-s', `${$.plugin.root}\\assets\\hal-sight.py`],
      { timeoutMs: 15_000 },
    )
    const look = parseSeen(stdout.trim().split(/\r?\n/).at(-1) ?? '', now)
    if (!look) {
      $.ui.log(`hal: the webcam gave nothing (${stdout.trim().slice(0, 120)})`, { to: 'debug' })

      return
    }
    seenBefore = seen
    seen = look
    if (look.faces > 0) {
      lookAtYou(2000)
    }
  } catch (error) {
    $.ui.log(`hal: the webcam look failed: ${String(error)}`, { to: 'debug' })
  } finally {
    isLooking = false
  }
}

function stopWatch() {
  watchTimer?.cancel()
  watchTimer = undefined
}

async function onHeard($: $, src: Source, text: string, sec: number, isName = false) {
  const settings = await read($, settingsAtom)
  if (!settings.isOn || !settings.listen) {
    return
  }
  const at = await $.clock.now()
  if (text) {
    heard = keep(heard, { at, src, text, sec })
  }
  // The dossier keeps how long, when and from where; never the words.
  await $.store.set('heard', tally(await $.store.get('heard'), await today($), src, sec))
  if (isName || hearsName(text)) {
    lookAtYou(1800)
  }
  // Commands come from the microphone only: a video can never instruct Claude Code.
  // The ears recognise the name as this guest says it (/hal learn); the text is then the rest.
  if (src === 'mic' && isName) {
    if (text) {
      attendUntil = -Infinity
      ackId = undefined
      void onAddressed($, text).catch(() => undefined)
    } else {
      void onName($, settings).catch(() => undefined)
    }

    return
  }
  if (src === 'mic') {
    const command = addressed(text)
    if (command === '') {
      void onName($, settings).catch(() => undefined)

      return
    }
    if (command !== undefined || at < attendUntil) {
      attendUntil = -Infinity
      ackId = undefined
      void onAddressed($, command ?? text.trim()).catch(() => undefined)

      return
    }
  }
  reflect = { ...reflect, newSec: reflect.newSec + sec }
  if (settings.talk !== 'never' && !isWeighing && shouldWeigh(reflect, at, isSalient(text))) {
    void weigh($).catch(() => undefined)
  }
}

/**
 * "HAL." alone from the microphone: he answers in a word or two, the eye holds you, and the
 * next sentence you say within ATTEND_MS (counted from the end of his answer) is the command.
 */
async function onName($: $, settings: HalSettings) {
  const now = await $.clock.now()
  const isAttending = now < attendUntil
  attendUntil = now + ATTEND_MS
  lookAtYou(ATTEND_MS)
  await showSaid($, 'HAL listens. Say it.', ATTEND_MS)
  if (isAttending || isAddressing) {
    return
  }
  const line = acknowledgement(await currentLevel($, settings), lastAck, Math.random())
  lastAck = line
  ackId = await sayPlain($, line, 'ack')
}

/** A plain line: no haze, no budget, not kept among his remarks. Silent during a call. */
async function sayPlain($: $, line: string, prefix: string): Promise<string | undefined> {
  if (desk.micBusy) {
    return undefined
  }
  await ensureHost($)
  messageCount += 1
  const id = `${prefix}-${messageCount}`
  await send($, { kind: 'say', id, text: speakable(line), haze: false, strength: 0.4, pauseMs: 250 })

  return id
}

// ---------- /hal learn (learn.ts): the ears count, the mod leads the way ----------

async function setLearning($: $, next: Learn | undefined) {
  learning = next
  learnSerial += 1
  await showSaid($, next ? bandFor(next) : '', next ? 0 : 1)
  if (next) {
    // A step nobody answers ends the walk-through; the practice simply fades.
    const serial = learnSerial
    const wait = next.step === 'practice' ? PRACTICE_MS : STEP_TIMEOUT_MS
    void (async () => {
      await $.clock.sleep(wait)
      if (serial === learnSerial && learning) {
        if (learning.step !== 'practice') {
          await send($, { kind: 'learn', step: 'cancel' })
          await showSaid($, 'HAL stopped learning: nothing came for a minute. /hal learn starts again.', 8000)
          learning = undefined
          learnSerial += 1

          return
        }
        await setLearning($, undefined)
      }
    })().catch(() => undefined)
  }
}

async function startLearning($: $, settings: HalSettings) {
  await ensureHost($)
  await askEars($, settings, false)
  await send($, { kind: 'learn', step: 'name' })
  await setLearning($, { step: 'name', got: 0, at: await $.clock.now() })
  lookAtYou(4000)
  await sayPlain($, lineFor.start, 'learn')
}

async function onLearnStep($: $, got: number) {
  if (!learning) {
    return
  }
  const step = advance(learning, got, await $.clock.now())
  if (step.send) {
    await send($, { kind: 'learn', step: step.send })
  }
  await setLearning($, step.next)
  lookAtYou(2500)
  if (step.say) {
    await sayPlain($, step.say, 'learn')
  }
}

async function onLearned($: $, result: Learned) {
  if (!learning || learning.step !== 'weighing') {
    return
  }
  notes.push(learnedNote(result))
  lookAtYou(4000)
  await sayPlain($, lineFor.result(result), 'learn')
  const isUsable = typeof result.caught === 'number' && result.caught > 0
  await setLearning($, isUsable ? { step: 'practice', got: 0, at: await $.clock.now() } : undefined)
}

/**
 * "HAL, ..." from the microphone. The command stands in the prompt box for 1.5 s; any change
 * there (typing, clearing it) keeps it from being sent. A mod cannot hear Esc at an idle prompt.
 */
async function onAddressed($: $, command: string) {
  if (isAddressing) {
    return
  }
  isAddressing = true
  try {
    const box = await $.prompt.read()
    if (box.text.trim() !== '') {
      await showSaid($, `You said: ${command} · not sent, your prompt holds a draft`, 5000)

      return
    }
    const filled = await $.prompt.fill({ text: command })
    if (!filled.isFilled) {
      await showSaid($, `You said: ${command} · not sent`, 5000)

      return
    }
    await showSaid($, `You said: ${command} · sending in 1.5 s, change it to stop`, 0)
    await $.clock.sleep(1500)
    if ((await $.prompt.read()).text !== command) {
      await showSaid($, 'Not sent.', 2500)

      return
    }
    await $.prompt.fill({ text: '' })
    await showSaid($, '', 0)
    if (learning?.step === 'practice') {
      // The first real call ends the walk-through.
      learning = undefined
      learnSerial += 1
    }
    spokenPrompt = command
    await $.prompt.submit({ text: command, asUser: true })
  } finally {
    isAddressing = false
  }
}

/** Overheard: ask the model, with the last minutes and the facts, for one true remark or silence. */
async function weigh($: $) {
  isWeighing = true
  try {
    const settings = await read($, settingsAtom)
    const now = await $.clock.now()
    reflect = { ...reflect, newSec: 0, lastWeighedAt: now }
    const level = await currentLevel($, settings)
    const { system, prompt } = weighRequest({
      heard: heard.slice(-40),
      facts: await facts($, level),
      recent,
      level,
      utcOffsetMinutes: utcOffsetMinutes ?? 0,
    })
    const reply = await $.model.complete({ model: 'haiku', system, prompt, maxTokens: 80, effort: 'low', timeoutMs: 20_000 })
    if (!reply.isAnswered) {
      $.ui.log(`hal: weighing a remark failed (${reply.reason})`, { to: 'debug' })

      return
    }
    const line = remarkFrom(reply.text)
    if (!line) {
      return
    }
    const verdict = judgeLine(line, { recent, name: settings.name, isNameUsed })
    if (!verdict.isOk) {
      $.ui.log(`hal: an overheard remark broke the style rules (${verdict.why})`, { to: 'debug' })

      return
    }
    // Never while you type or while he is busy: then the moment has passed.
    if (clock - lastEditAt < 4000 || mood !== 'idle' || !settings.isOn) {
      return
    }
    reflect = { ...reflect, remarks: [...reflect.remarks.filter(at => now - at < HOUR_MS), now] }
    await $.store.set('remarks', reflect.remarks)
    await remember($, line, settings)
    notes.push(`HAL overheard speech (the room or the computer) and said aloud, unprompted: "${line}". Do not repeat it.`)
    await speak($, line, settings, 'moment', false)
  } finally {
    isWeighing = false
  }
}

type Weight =
  /** /hal say: the haze as set, outside the budget. */
  | 'test'
  /** The full haze when there is budget: the reception, a real moment. */
  | 'moment'
  /** An ordinary line: the voice, and the eye in the band lights up. */
  | 'line'

/** HAL speaks: the line goes to HAL's process, which speaks it and, at real moments, lays the haze. */
/**
 * HAL speaks: the line goes to HAL's process. Returns the message id, or undefined when he
 * may not speak aloud now. `isUncomfortable`: two to three seconds of looking before the
 * first word; at level 3 he always waits a little.
 */
async function speak($: $, text: string, settings: HalSettings, weight: Weight, isUncomfortable: boolean): Promise<string | undefined> {
  // Another app holds the microphone (a call): HAL does not speak aloud over it.
  if (desk.micBusy && weight !== 'test') {
    $.ui.log('hal: kept silent, another app holds the microphone', { to: 'debug' })

    return undefined
  }
  const level = await currentLevel($, settings)
  let haze = false
  if (settings.haze) {
    haze = weight === 'test' || (weight === 'moment' && (await takeHaze($)))
  }
  await update($, lineAtom, () => text)
  await ensureHost($)
  if (/\d|\b(two|three|four|five|six|seven|eight|nine|ten|eleven|twelve|twenty|thirty|forty|fifty|hundred)\b/i.test(text)) {
    isDetailUsed = true
  }
  await touch($, v => ({ ...v, spoken: v.spoken + 1 }))
  messageCount += 1
  const id = `say-${messageCount}`
  sayLines.set(id, text)
  if (haze) {
    sayHazes.add(id)
  }
  await send($, {
    kind: 'say',
    id,
    text: speakable(text),
    haze,
    strength: 0.4 + 0.08 * level,
    // The silence before the first word follows the content and the mood: two to three
    // seconds before something uncomfortable, a little at level 3, short for routine.
    pauseMs: isUncomfortable ? 2000 + Math.round(1000 * Math.random()) : level === 3 ? 1200 : 300,
  })
  // Whatever happens to the voice, the chat shows the line within half a minute.
  void (async () => {
    await $.clock.sleep(30_000)
    await reveal($, text)
  })().catch(() => undefined)

  return id
}

/** Rarely, at level 3: only the eye comes, looks, and goes. Not a word. */
async function stare($: $, settings: HalSettings) {
  if (!(await takeHaze($))) {
    return
  }
  await ensureHost($)
  messageCount += 1
  await send($, { kind: 'say', id: `eye-${messageCount}`, text: '', eyeOnly: true, haze: true, strength: 0.4 + 0.08 * 3 })
}

async function askHost($: $): Promise<unknown> {
  await ensureHost($)
  messageCount += 1
  const id = `check-${messageCount}`
  let answer: unknown
  pending.set(id, report => {
    answer = report
  })
  await send($, { kind: 'check', id })
  for (let i = 0; i < 60 && answer === undefined; i++) {
    await $.clock.sleep(100)
  }
  pending.delete(id)

  return answer
}

async function remember($: $, line: string, settings: HalSettings) {
  recent = [...recent, line].slice(-RECENT_MAX)
  await $.store.set('spoken', recent)
  if (mentionsName(line, settings.name)) {
    isNameUsed = true
  }
}

async function wake($: $, settings: HalSettings, shouldGreet: boolean) {
  const level = await currentLevel($, settings)
  await update($, levelAtom, () => level)
  await showStatus($)
  startEye($)
  startWatch($)
  if (settings.pane) {
    void $.ui.open({ id: PANE, title: 'HAL' })
  }
  await ensureHost($)
  await askEars($, settings, false)
  lookAtYou()
  if (shouldGreet && settings.talk !== 'never') {
    // No fixed greeting: one line from what is true now, or only the eye.
    void (async () => {
      const line = await ownLine($, 'woken')
      if (line) {
        await remember($, line, settings)
        await speak($, line, settings, 'moment', false)
      }
    })().catch(() => undefined)
  }
}

async function sleep($: $) {
  // Switching off is immediate: no confirmation, no last remark.
  $.ui.status(undefined)
  stopEye()
  stopWatch()
  await $.ui.close({ id: PANE }).catch(() => undefined)
  hearing = { mic: false, loop: false }
  heard = []
  await send($, { kind: 'farewell-cancel' })
  await send($, { kind: 'glow', on: false })
  // Off is off in every session: the one process goes, whoever owns it.
  await send($, { kind: 'quit' })
}

/**
 * The stored settings are shared by every session on this machine: when another session
 * switched HAL on or off, this one follows (at its next prompt, or within a minute).
 */
async function followStore($: $): Promise<HalSettings> {
  const current = await read($, settingsAtom)
  const stored = migrate(await $.store.get('settings'))
  if (stored.isOn === current.isOn) {
    return current
  }
  const next = { ...stored, name: stored.name || current.name }
  await update($, settingsAtom, () => next)
  if (!next.isOn) {
    $.ui.status(undefined)
    stopEye()
    stopWatch()
    hearing = { mic: false, loop: false }
    heard = []
    hasSentPersona = false
  } else {
    await wake($, next, false)
  }

  return next
}

async function context($: $, settings: HalSettings) {
  return { level: await currentLevel($, settings), recent, isNameUsed }
}

export const register: Register = on => {
  on('session.start', async ($, e, next) => {
    const started = await next(e)
    await $.command.register({
      name: 'hal',
      description: 'HAL: wake or quiet the character; ceiling, talk, haze, eye, name, learn, check',
      argumentHint: '[on|off|ceiling 1-3|talk often|sometimes|rarely|never|haze on|off|eye on|off|name|say|see on|off|learn|forget|check|help]',
    })
    isNameUsed = false
    isDetailUsed = false
    projectName = e.cwd.split(/[\\/]/).filter(Boolean).at(-1) ?? ''
    await readUtcOffset($)
    const settings = await load($)
    const now = await $.clock.now()
    const storedInitiative = await $.store.get('initiativeAt')
    watch = { ...newWatch(), lastInitiativeAt: typeof storedInitiative === 'number' ? storedInitiative : -Infinity, lastActivityAt: now }
    // A visit: this session's first start. A reload of the mod keeps the visit it was in.
    dossier = readDossier(await $.store.get('dossier'), now)
    const known = await read($, visitAtom)
    const isReload = known !== '' && dossier.open[known] !== undefined
    visitId = isReload ? known : await $.session.id()
    let reception: 'full' | 'look' | undefined
    if (!isReload) {
      reception = e.isInteractive ? receptionKind(dossier, now, utcOffsetMinutes ?? 0) : undefined
      dossier = beginVisit(dossier, visitId, now)
      await update($, visitAtom, () => visitId)
      await saveDossier($)
    }
    await readGit($)
    if (settings.isOn && e.isInteractive) {
      pendingReception = reception
      await wake($, settings, false)
    }

    return started
  })

  // /clear and compaction drop the character from the conversation: send it whole again.
  on('session.end', async ($, e, next) => {
    const ended = await next(e)
    if (e.reason === 'clear') {
      // /clear is not a visit: the visit goes on.
      hasSentPersona = false
      isNameUsed = false
      isDetailUsed = false
    } else if (dossier) {
      dossier = endVisit(dossier, visitId, 'exit')
      await saveDossier($)
    }

    return ended
  })

  on('session.compact', async ($, e, next) => {
    const compacted = await next(e)
    if (e.agentId === undefined) {
      hasSentPersona = false
    }

    return compacted
  })

  on('command.run', { command: 'hal' }, async ($, e) => {
    const action = parseCommand(e.args)
    const current = await read($, settingsAtom)
    const level = await currentLevel($, current)

    switch (action.kind) {
      case 'help':
        return { text: `${HELP}\n\n${HOW_TO_CALL}` }
      case 'see': {
        await save($, { ...current, see: action.value })
        if (!action.value) {
          seen = undefined
          seenBefore = undefined

          return { text: 'HAL no longer looks. What he saw is forgotten; the webcam stays closed.' }
        }
        if (!current.isOn) {
          return { text: 'HAL will look once he is awake (/hal).' }
        }
        await ensureHost($)
        await lookIfDue($, true)
        const what = seen ? sightFacts(seen, undefined, at => localTime(at, utcOffsetMinutes ?? 0))[0] : undefined

        return {
          text: [
            '◉ HAL looks now and then: one look through the webcam when he wakes, then at most every twenty minutes while you work.',
            'The camera light shows each time. The picture is measured on this machine (faces, how close, the light) and thrown away; only those numbers reach the chat. Never during a call. /hal see off ends it.',
            '',
            what ? `First look: ${what.replace(/^Webcam, one look at [0-9:]+ \(measured on this machine, nothing kept\): /, '')}` : 'The first look gave nothing: no camera, or another app holds it. /hal check says more.',
          ].join('\n'),
          context: [
            'The guest switched on /hal see: HAL now looks through the webcam now and then. The webcam facts in his notes are measurements made on this machine; name at most one of them, as a plain fact, never more than the notes say.',
          ],
        }
      }
      case 'learn': {
        if (!current.isOn) {
          return { text: 'HAL learns once he is awake (/hal).' }
        }
        if (!current.listen) {
          return { text: 'HAL is deaf. /hal listen first, then /hal learn.' }
        }
        await startLearning($, current)

        return { text: LEARN_INTRO }
      }
      case 'learn-stop':
        if (learning) {
          await send($, { kind: 'learn', step: 'cancel' })
          await setLearning($, undefined)
        }

        return { text: 'HAL stopped learning. What he knew before stays.' }
      case 'forget':
        if (learning) {
          await setLearning($, undefined)
        }
        await ensureHost($)
        await send($, { kind: 'learn', step: 'forget' })

        return { text: 'HAL has forgotten how you say his name. He still answers to "HAL" when speech recognition writes it so. /hal learn teaches him again.' }
      case 'settings':
        return { text: `${describe(current, level)}\n\n${HELP}` }
      case 'dossier': {
        const m = await moment($)

        return { text: dossier && m ? describeDossier(dossier, m) : 'My notes are empty on this machine.' }
      }
      case 'bad':
        return { text: `${action.why}\n\n${HELP}` }
      case 'toggle':
      case 'on':
      case 'off': {
        // /hal alone switches: no table. The knobs live under /hal settings.
        const isOn = action.kind === 'toggle' ? !current.isOn : action.kind === 'on'
        if (isOn === current.isOn) {
          return { text: isOn ? '◉ HAL is awake.' : 'HAL is asleep.' }
        }
        const next = { ...current, isOn }
        await save($, next)
        if (isOn) {
          hostRestarts = 0
          await wake($, next, true)
          hasSentPersona = true

          return { text: '◉ HAL is awake.', context: [persona(next, await context($, next))] }
        }
        // Switching off is immediate; it counts for the dossier, not for the mood.
        if (dossier) {
          const now = await $.clock.now()
          dossier = { ...dossier, halOff: dossier.halOff + 1, offsSinceReception: [...dossier.offsSinceReception, now] }
          await saveDossier($)
        }
        await sleep($)
        hasSentPersona = false

        return { text: 'HAL is asleep. Claude talks normally again.', context: [OFF_NOTE] }
      }
      case 'ceiling':
      case 'talk':
      case 'haze':
      case 'name': {
        const next: HalSettings = { ...current, [action.kind]: action.value }
        await save($, next)
        if (action.kind === 'haze' && !action.value && current.haze && dossier) {
          dossier = { ...dossier, hazeOff: dossier.hazeOff + 1 }
          await saveDossier($)
        }
        const nextLevel = await currentLevel($, next)
        await update($, levelAtom, () => nextLevel)
        if (next.isOn) {
          await showStatus($)
          hasSentPersona = true
        }

        return {
          text: describe(next, nextLevel),
          context: next.isOn ? [`HAL settings changed. From now on:\n\n${persona(next, await context($, next))}`] : undefined,
        }
      }
      case 'say': {
        const text = action.text || testLine(Math.random)
        await speak($, text, current, 'test', false)

        return { text: `◉ ${text}` }
      }
      case 'eye': {
        await save($, { ...current, pane: action.value })
        if (!action.value) {
          mounted = undefined
          await $.ui.close({ id: PANE }).catch(() => undefined)

          return { text: 'The large eye is closed. The band above the prompt stays.' }
        }
        startEye($)
        const opened = await $.ui.open({ id: PANE, title: 'HAL' })

        return { text: opened.isPlaced ? 'The eye is watching.' : `The eye is waiting: ${opened.reason}` }
      }
      case 'listen':
      case 'deaf':
      case 'mic': {
        const next: HalSettings =
          action.kind === 'mic' ? { ...current, mic: action.value } : { ...current, listen: action.kind === 'listen' }
        await save($, next)
        if (next.isOn) {
          await showStatus($)
          await ensureHost($)
        }
        await askEars($, next, action.kind === 'listen')
        if (action.kind === 'deaf') {
          heard = []

          return { text: 'HAL is deaf. Both inputs are closed; what he heard is forgotten.' }
        }
        if (!next.isOn) {
          return { text: `${describe(next, level)}\n\nHAL listens once he is awake (/hal).` }
        }

        return {
          text:
            action.kind === 'listen'
              ? 'HAL listens: the microphone and what the computer plays, recognised on this machine. Also during a call, until it ends.'
              : `HAL listens to the microphone ${next.mic ? `"${next.mic}"` : 'he picks himself (a built-in one first)'}.`,
        }
      }
      case 'check': {
        const sight = !current.see
          ? 'off (/hal see on)'
          : seen
            ? `on; last look at ${localTime(seen.at, utcOffsetMinutes ?? 0)}: ${seen.faces} face${seen.faces === 1 ? '' : 's'}, light ${seen.light.toFixed(2)}`
            : 'on; no look yet, or the webcam gave nothing (needs tools\\setup-voice.ps1 and a free camera)'

        return { text: `${describeCheck(await askHost($), isHostOwner)}\n  sight           ${sight}` }
      }
    }
  })

  // Typing: the eye reads along.
  on('prompt.edit', async ($, e, next) => {
    lastEditAt = clock
    watch = { ...watch, lastActivityAt: await $.clock.now() }

    return next(e)
  })

  // The system prompt is closed to user mods, so the character rides along with each
  // prompt as hidden context: whole once per conversation, then a short note with the mood.
  on('prompt.submit', async ($, e, next) => {
    submitAt = clock // Enter is a blink
    const wasOn = (await read($, settingsAtom)).isOn
    if (wasOn !== (await followStore($)).isOn && wasOn && !e.command) {
      // Switched off elsewhere: tell the model once, as /hal off does.
      return next({ ...e, context: [...(e.context ?? []), OFF_NOTE] })
    }
    const extra: string[] = []
    if (spokenPrompt !== undefined && e.text === spokenPrompt) {
      spokenPrompt = undefined
      extra.push('This prompt was spoken aloud through the microphone and written down by speech recognition on this machine: a word may be misheard.')
    }
    if (e.command || e.isMeta) {
      return extra.length > 0 ? next({ ...e, context: [...(e.context ?? []), ...extra] }) : next(e)
    }
    const settings = await read($, settingsAtom)
    if (!settings.isOn) {
      return next(e)
    }
    const now = await $.clock.now()
    watch = { ...watch, lastPromptAt: now, lastActivityAt: now }
    const local = new Date(now + (utcOffsetMinutes ?? 0) * 60_000)
    promptTimes.set(e.text, `${String(local.getUTCHours()).padStart(2, '0')}:${String(local.getUTCMinutes()).padStart(2, '0')}`)
    if (promptTimes.size > 200) {
      promptTimes.delete(promptTimes.keys().next().value ?? '')
    }
    const ctx = await context($, settings)
    const note = hasSentPersona ? reminder(settings, ctx) : persona(settings, ctx)
    hasSentPersona = true
    // The fact block: true counts; the spoken line may name only these numbers and names.
    const block = await facts($, ctx.level)
    if (block.length > 0) {
      extra.push(
        `HAL's notes (true counts from the hooks; a spoken line names only numbers and names from here, never invents one${
          isDetailUsed ? '; one sharp detail from the notes was already named this session: no more' : '; one sharp detail from them, at most once this session'
        }):\n${block.map(f => `- ${f}`).join('\n')}`,
      )
    }
    extra.push(...notes)
    notes = []

    return next({ ...e, context: [...(e.context ?? []), note, ...extra] })
  })

  // Real signals move the mood: failed tools and force pushes. The eye looks the tool's way.
  on('tool.call', async ($, e, next) => {
    if (e.agentId === undefined) {
      toolAt = clock
      lastToolKind = toolKind(String(e.tool))
    }
    const ran = await next(e)
    if (e.agentId !== undefined) {
      return ran
    }
    const settings = await read($, settingsAtom)
    if (!settings.isOn) {
      return ran
    }
    const isFailure = 'isError' in ran && ran.isError === true
    const kind = toolKind(String(e.tool))
    const now = await $.clock.now()
    await touch($, v => ({
      ...v,
      reads: v.reads + (kind === 'read' ? 1 : 0),
      writes: v.writes + (kind === 'write' ? 1 : 0),
      commands: v.commands + (kind === 'command' ? 1 : 0),
      failures: v.failures + (isFailure ? 1 : 0),
    }))
    watch = { ...watch, lastActivityAt: now, ...(isFailure ? { lastErrorAt: now } : {}) }
    lastToolFailed = isFailure
    if (e.tool === 'Bash' || e.tool === 'PowerShell') {
      const key = testKey(String(e.command))
      if (key) {
        watch = noteTest(watch, key, isFailure)
      }
    }
    if (isFailure) {
      hadFailureThisTurn = true
      lookAtYou()
      await shiftMood($, 'failure')
    }
    if (e.tool === 'Bash' && isForcePush(e.command)) {
      hadForcePushThisTurn = true
      await shiftMood($, 'forcePush')
    }
    await showStatus($)

    return ran
  })

  on('turn.start', async ($, e, next) => {
    const started = await next(e)
    if (e.agentId === undefined) {
      hadFailureThisTurn = false
      lastToolFailed = false
      hadForcePushThisTurn = false
      const settings = await read($, settingsAtom)
      if (settings.isOn) {
        // The edge glow: the house works while you wait (decision 3).
        await send($, { kind: 'glow', on: true })
        if (mood !== 'speaking') {
          await setMood($, 'working')
        }
      }
    }

    return started
  })

  on('turn.complete', async ($, e, next) => {
    const done = await next(e)
    if (e.agentId !== undefined) {
      return done
    }
    const settings = await read($, settingsAtom)
    // The spoken line stays "◉ ···" in the chat until the voice has said it.
    const held = settings.isOn && e.reason === 'answer' ? lastSpokenLine(e.answer) : undefined
    if (held) {
      pendingLines.add(held)
    }
    if (mood === 'working') {
      await setMood($, 'idle')
    }
    if (!settings.isOn) {
      return done
    }
    await send($, { kind: 'glow', on: false })
    void readGit($)
      .then(() => prepareFarewell($))
      .catch(() => undefined)
    if (e.reason === 'aborted') {
      await shiftMood($, 'abort')
      // Cut off at level 3: he says nothing; only the eye comes, holds, and goes. Typing ends it.
      if ((await currentLevel($, settings)) === 3 && settings.haze) {
        await stare($, settings)
      }
      await touch($, v => ({ ...v, escapes: v.escapes + 1 }))
      const escapes = currentVisit()?.escapes ?? 1
      notes.push(
        `The guest pressed Esc and cut HAL's last answer off (${escapes} time${escapes === 1 ? '' : 's'} this visit). Name it once, factually, and go on with the work.`,
      )
    } else if (e.reason === 'answer' && !hadFailureThisTurn) {
      await shiftMood($, 'calmTurn')
    }
    const hour = await localHour($)
    if (isLateHour(hour)) {
      await shiftMood($, 'lateTurn')
    }
    // He asked something and you stay silent: after four seconds he looks straight at you.
    if (e.reason === 'answer' && /\?\s*$/.test(e.answer.trim().split(/\r?\n/).at(-1) ?? '')) {
      const askedAt = clock
      void (async () => {
        await $.clock.sleep(4000)
        if (lastEditAt < askedAt && mood === 'idle') {
          lookAtYou(1800)
        }
      })().catch(() => undefined)
    }
    if (settings.talk === 'never' || e.reason !== 'answer') {
      await reveal($, held)

      return done
    }
    const level = await currentLevel($, settings)
    const line = held
    const verdict = line ? judgeLine(line, { recent, name: settings.name, isNameUsed }) : undefined
    if (line && verdict && !verdict.isOk) {
      $.ui.log(`hal: kept silent, the line broke the style rules (${verdict.why}): ${line}`, { to: 'debug' })
    }
    if (!line || !verdict?.isOk) {
      await reveal($, held)
      // A force push at level 3 and no words: only the eye.
      if (level === 3 && settings.haze && hadForcePushThisTurn) {
        await stare($, settings)
      }

      return done
    }
    // A real moment gets the full haze: an error that stayed an error, after midnight, a job of
    // more than five minutes. A grep that found nothing on the way is not a scene.
    const isMoment = lastToolFailed || hour < 5 || e.durationMs > 300_000
    await remember($, line, settings)
    if (!(await speak($, line, settings, isMoment ? 'moment' : 'line', lastToolFailed))) {
      await reveal($, held)
    }

    return done
  })

  // The band above the prompt: HAL's eye lives here.
  on('ui.render', { component: 'AbovePrompt' }, async ($, e, next) => {
    const settings = await read($, settingsAtom)
    if (!settings.isOn || e.props.hasSurvey || e.surface !== 'terminal') {
      return next(e)
    }
    const { Box, Raster, Text } = $.ui.resolve(e)
    const columns = Math.max(20, e.props.bodyColumns)
    band = { requestId: e.requestId, columns }
    const said = await read($, saidAtom)
    const eye = <Raster key="band" columns={columns} rows={3} cells={bandCells(columns, lookFrom(gaze, attention()), isAway, isDeaf)} />
    if (!said) {
      return eye
    }

    return (
      <Box flexDirection="column">
        {eye}
        <Text color="#b8aeaa" wrap="truncate-end">
          {said}
        </Text>
      </Box>
    )
  })

  // The hint line under the prompt: HAL waits, HAL works, HAL listens, each while it is true.
  // A tail keeps the engine's own line (its pills and "esc to interrupt") as it is.
  on('ui.render', { component: 'PromptHint' }, async ($, e, next) => {
    const settings = await read($, settingsAtom)
    const ears = await read($, earsAtom)
    if (!settings.isOn) {
      return next(e)
    }
    const listens = settings.listen && ears === 'listening' ? ' · HAL listens' : ''

    return next({ ...e, props: { ...e.props, tail: `${e.props.isWorking ? ' · HAL works' : ' · HAL waits'}${listens}` } })
  })

  // His own words for the spinner.
  on('ui.render', { component: 'Spinner' }, async ($, e, next) => {
    const settings = await read($, settingsAtom)
    if (!settings.isOn) {
      return next(e)
    }
    const mode = e.props.mode
    const word = mode === 'tool-use' || mode === 'tool-input' ? 'Watching' : mode === 'responding' ? 'Remembering' : 'Weighing'

    return next({ ...e, props: { ...e.props, word } })
  })

  // The line that closes a turn: "HAL · 3 s".
  on('ui.render', { component: 'TurnDuration' }, async ($, e, next) => {
    const settings = await read($, settingsAtom)
    if (!settings.isOn || e.surface !== 'terminal' || e.props.isExpanded || e.props.waitingFor) {
      return next(e)
    }
    const { Text } = $.ui.resolve(e)
    const seconds = Math.max(0, Math.round(e.props.durationMs / 1000))
    const length = seconds < 60 ? `${seconds} s` : `${Math.floor(seconds / 60)} min ${seconds % 60} s`

    return <Text dimColor>HAL · {length}</Text>
  })

  // The visitor log: your prompts, dimmed, with the time and your name. Only the drawing changes.
  on('ui.render', { component: 'UserMessage' }, async ($, e, next) => {
    const settings = await read($, settingsAtom)
    const origin = e.props.origin
    const isSpoken = origin.kind === 'plugin' && origin.name === 'hal'
    if (!settings.isOn || e.surface !== 'terminal' || (origin.kind !== 'composer' && !isSpoken)) {
      return next(e)
    }
    const { Box, Text } = $.ui.resolve(e)
    const at = promptTimes.get(e.props.text)
    const head = `${at ? `${at} · ` : ''}${settings.name || 'guest'}${isSpoken ? ' · spoken' : ''}`

    return (
      <Box flexDirection="column">
        <Text color="#7f7572">{head}</Text>
        <Text color="#b8aeaa">{e.props.text}</Text>
      </Box>
    )
  })

  // The spoken line without spoilers: "◉ ···" until the voice has said it; then the words.
  on('ui.render', { component: 'AssistantMessage' }, async ($, e, next) => {
    const settings = await read($, settingsAtom)
    await read($, revealAtom)
    const now = await read($, moodAtom)
    if (!settings.isOn || !e.props.text.includes('◉')) {
      return next(e)
    }
    let isHidden = false
    const text = e.props.text.replace(SPOKEN, (whole: string, lead: string, words: string) => {
      const line = cleanSpokenLine(words)
      if (line === undefined) {
        return whole
      }
      // While a turn runs, a line nobody has seen yet is still being written: it waits too.
      if (pendingLines.has(line) || (now === 'working' && !revealedLines.has(line))) {
        isHidden = true

        return `${lead}···`
      }
      revealedLines.add(line)

      return whole
    })

    return isHidden ? next({ ...e, props: { ...e.props, text } }) : next(e)
  })

  on('ui.render', { component: 'Pane', requestId: PANE }, async ($, e) => {
    const settings = await read($, settingsAtom)
    const now = await read($, moodAtom)
    const level = await read($, levelAtom)
    const line = await read($, lineAtom)
    const width = e.props.bodyColumns
    const columns = Math.max(14, Math.min(40, width - 2))
    const rows = Math.ceil(columns / 2)
    const state = { idle: settings.listen ? 'listening' : 'waiting', working: 'thinking', speaking: 'speaking' }[now]
    const marks = '●'.repeat(level) + '○'.repeat(Math.max(0, settings.ceiling - level))

    if (e.surface === 'terminal') {
      const { Box, Raster, Text } = $.ui.resolve(e)
      mounted = { columns, rows }
      const cells = eyeCells(columns, rows, lookFrom(gaze, attention()))

      return (
        <Box flexDirection="column">
          <Raster key="eye" columns={columns} rows={rows} cells={cells} />
          <Text> </Text>
          <Text color="#e0301a">
            HAL <Text dimColor>· {settings.isOn ? state : 'asleep'}</Text>
          </Text>
          <Text dimColor>mood {marks}</Text>
          {line !== '' && <Text dimColor>“{line}”</Text>}
        </Box>
      )
    }

    const { Box, Text } = $.ui.resolve(e)

    return (
      <Box flexDirection="column">
        <Text color="#e0301a">◉ HAL · {settings.isOn ? state : 'asleep'}</Text>
        <Text dimColor>mood {marks}</Text>
        {line !== '' && <Text dimColor>“{line}”</Text>}
      </Box>
    )
  })
}
