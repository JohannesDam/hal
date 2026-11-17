import { atom, read, update } from 'claude-code'
import type { EngineInterface, Register } from 'claude-code'

import type { HalLevel, HalMood, HalSettings } from '../types'
import { addressed, hearsName, isSalient, keep, remarkFrom, shouldWeigh, tally, weighRequest } from './ears'
import type { Heard, ReflectState, Source } from './ears'
import { bandCells, eyeCells } from './eye'
import { lookFrom, newGazeState, stepGazeState, toolKind } from './gaze'
import type { Attention, ToolKind } from './gaze'
import { isForcePush, isLateHour, moodLevel, moveMood, returnMood } from './mood'
import type { MoodEvent } from './mood'
import {
  DEFAULTS,
  HELP,
  OFF_NOTE,
  describe,
  describeCheck,
  greeting,
  judgeLine,
  lastSpokenLine,
  mentionsName,
  migrate,
  parseCommand,
  persona,
  reminder,
  speakable,
  statusText,
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
let saidSerial = 0
/** The prompt HAL is about to send for you, as you spoke it. */
let spokenPrompt: string | undefined
/** What the model must know with the next prompt: what HAL said unprompted. */
let notes: string[] = []
let awakeSince = 0
let projectName = ''

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
    $.ui.status(statusText(settings, level))
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
      return 'busy'
    case 'ready':
      if (typeof message.pid === 'number') {
        isHostOwner = true
        await askEars($, await read($, settingsAtom), false)
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
        await onHeard($, message.src, message.text, typeof message.sec === 'number' ? message.sec : 0)
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
      break
    case 'dropped':
      isAway = false
      await setMood($, 'idle')
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
    } else if (hostRestarts < 1 && (await read($, settingsAtom)).isOn) {
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
  void runHost($)
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

/** The local date, for the dossier's tally of heard speech. */
async function today($: $): Promise<string> {
  return new Date((await $.clock.now()) + (utcOffsetMinutes ?? 0) * 60_000).toISOString().slice(0, 10)
}

/** Facts the model may use; the dossier (step 6) will add to them. Never the words heard. */
async function facts($: $, level: HalLevel): Promise<string[]> {
  const now = await $.clock.now()
  const local = new Date(now + (utcOffsetMinutes ?? 0) * 60_000)
  const time = `${String(local.getUTCHours()).padStart(2, '0')}:${String(local.getUTCMinutes()).padStart(2, '0')}`
  const room = heard.filter(h => h.src === 'mic').reduce((sum, h) => sum + h.sec, 0)
  const computer = heard.filter(h => h.src === 'loop').reduce((sum, h) => sum + h.sec, 0)

  return [
    `Local time ${time}.`,
    projectName ? `The guest is working in the folder "${projectName}".` : 'The project folder is unknown.',
    `HAL has been awake for ${Math.max(0, Math.round((now - awakeSince) / 60_000))} minutes this session; mood level ${level}.`,
    `Speech in the last five minutes: ${Math.round(room)} s from the room, ${Math.round(computer)} s from the computer.`,
  ]
}

async function onHeard($: $, src: Source, text: string, sec: number) {
  const settings = await read($, settingsAtom)
  if (!settings.isOn || !settings.listen) {
    return
  }
  const at = await $.clock.now()
  heard = keep(heard, { at, src, text, sec })
  // The dossier keeps how long, when and from where; never the words.
  await $.store.set('heard', tally(await $.store.get('heard'), await today($), src, sec))
  if (hearsName(text)) {
    lookAtYou(1800)
  }
  // Commands come from the microphone only: a video can never instruct Claude Code.
  if (src === 'mic') {
    const command = addressed(text)
    if (command !== undefined) {
      if (command) {
        void onAddressed($, command).catch(() => undefined)
      }

      return
    }
  }
  reflect = { ...reflect, newSec: reflect.newSec + sec }
  if (settings.talk !== 'never' && !isWeighing && shouldWeigh(reflect, at, isSalient(text))) {
    void weigh($).catch(() => undefined)
  }
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
    await speak($, line, settings, 'moment', level === 3)
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
async function speak($: $, text: string, settings: HalSettings, weight: Weight, isUncomfortable: boolean) {
  const level = await currentLevel($, settings)
  let haze = false
  if (settings.haze) {
    haze = weight === 'test' || (weight === 'moment' && (await takeHaze($)))
  }
  await update($, lineAtom, () => text)
  await ensureHost($)
  messageCount += 1
  await send($, {
    kind: 'say',
    id: `say-${messageCount}`,
    text: speakable(text),
    haze,
    strength: 0.4 + 0.08 * level,
    // Short for routine; two to three seconds of staring before something uncomfortable.
    pauseMs: isUncomfortable ? 2000 + Math.round(1000 * Math.random()) : 300,
  })
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
  $.ui.status(statusText(settings, level))
  startEye($)
  if (settings.pane) {
    void $.ui.open({ id: PANE, title: 'HAL' })
  }
  await ensureHost($)
  awakeSince = await $.clock.now()
  await askEars($, settings, false)
  lookAtYou()
  if (shouldGreet && settings.talk !== 'never') {
    await speak($, greeting(Math.random), settings, 'moment', false)
  }
}

async function sleep($: $) {
  // Switching off is immediate: no confirmation, no last remark.
  $.ui.status(undefined)
  stopEye()
  await $.ui.close({ id: PANE }).catch(() => undefined)
  hearing = { mic: false, loop: false }
  heard = []
  if (isHostOwner) {
    await send($, { kind: 'quit' })
  } else {
    await send($, { kind: 'ears', on: false })
  }
}

async function context($: $, settings: HalSettings) {
  return { level: await currentLevel($, settings), recent, isNameUsed }
}

export const register: Register = on => {
  on('session.start', async ($, e, next) => {
    const started = await next(e)
    await $.command.register({
      name: 'hal',
      description: 'HAL: wake or quiet the character; ceiling, talk, haze, eye, name, check',
      argumentHint: '[on|off|ceiling 1-3|talk often|sometimes|rarely|never|haze on|off|eye on|off|name|say|check|help]',
    })
    isNameUsed = false
    projectName = e.cwd.split(/[\\/]/).filter(Boolean).at(-1) ?? ''
    await readUtcOffset($)
    const settings = await load($)
    if (settings.isOn && e.isInteractive) {
      await wake($, settings, false)
    }

    return started
  })

  // /clear and compaction drop the character from the conversation: send it whole again.
  on('session.end', async ($, e, next) => {
    const ended = await next(e)
    if (e.reason === 'clear') {
      hasSentPersona = false
      isNameUsed = false
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
        return { text: `${describe(current, level)}\n\n${HELP}` }
      case 'bad':
        return { text: `${action.why}\n\n${HELP}` }
      case 'toggle':
      case 'on': {
        if (current.isOn && action.kind === 'toggle') {
          return { text: `${describe(current, level)}\n\n/hal help lists all options.` }
        }
        const next = { ...current, isOn: true }
        await save($, next)
        hostRestarts = 0
        await wake($, next, true)
        hasSentPersona = true

        return {
          text: `◉ HAL is awake.\n${describe(next, level)}`,
          context: [persona(next, await context($, next))],
        }
      }
      case 'off': {
        const next = { ...current, isOn: false }
        await save($, next)
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
        const nextLevel = await currentLevel($, next)
        await update($, levelAtom, () => nextLevel)
        if (next.isOn) {
          $.ui.status(statusText(next, nextLevel))
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
          $.ui.status(statusText(next, level))
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
      case 'check':
        return { text: describeCheck(await askHost($), isHostOwner) }
    }
  })

  // Typing: the eye reads along.
  on('prompt.edit', ($, e, next) => {
    lastEditAt = clock

    return next(e)
  })

  // The system prompt is closed to user mods, so the character rides along with each
  // prompt as hidden context: whole once per conversation, then a short note with the mood.
  on('prompt.submit', async ($, e, next) => {
    submitAt = clock // Enter is a blink
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
    const ctx = await context($, settings)
    const note = hasSentPersona ? reminder(settings, ctx) : persona(settings, ctx)
    hasSentPersona = true
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
    if ('isError' in ran && ran.isError) {
      hadFailureThisTurn = true
      lookAtYou()
      await shiftMood($, 'failure')
    }
    if (e.tool === 'Bash' && isForcePush(e.command)) {
      await shiftMood($, 'forcePush')
    }

    return ran
  })

  on('turn.start', async ($, e, next) => {
    const started = await next(e)
    if (e.agentId === undefined) {
      hadFailureThisTurn = false
      if (mood !== 'speaking') {
        const settings = await read($, settingsAtom)
        if (settings.isOn) {
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
    if (mood === 'working') {
      await setMood($, 'idle')
    }
    if (!settings.isOn) {
      return done
    }
    if (e.reason === 'aborted') {
      await shiftMood($, 'abort')
    } else if (e.reason === 'answer' && !hadFailureThisTurn) {
      await shiftMood($, 'calmTurn')
    }
    const hour = await localHour($)
    if (isLateHour(hour)) {
      await shiftMood($, 'lateTurn')
    }
    if (settings.talk === 'never' || e.reason !== 'answer') {
      return done
    }
    const level = await currentLevel($, settings)
    const line = lastSpokenLine(e.answer)
    const verdict = line ? judgeLine(line, { recent, name: settings.name, isNameUsed }) : undefined
    if (line && verdict && !verdict.isOk) {
      $.ui.log(`hal: kept silent, the line broke the style rules (${verdict.why}): ${line}`, { to: 'debug' })
    }
    if (!line || !verdict?.isOk) {
      if (level === 3 && settings.haze && Math.random() < 0.12) {
        await stare($, settings)
      }

      return done
    }
    // A real moment gets the full haze: an error, after midnight, a job of more than two minutes.
    const isMoment = hadFailureThisTurn || hour < 5 || e.durationMs > 120_000
    await remember($, line, settings)
    await speak($, line, settings, isMoment ? 'moment' : 'line', hadFailureThisTurn || level === 3)

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

  // The hint line under the prompt says it while it is true.
  on('ui.render', { component: 'PromptHint' }, async ($, e, next) => {
    const settings = await read($, settingsAtom)
    const ears = await read($, earsAtom)
    if (!settings.isOn || !settings.listen || ears !== 'listening') {
      return next(e)
    }

    return next({ ...e, props: { ...e.props, tail: ' · HAL listens' } })
  })

  on('ui.render', { component: 'Pane', requestId: PANE }, async ($, e) => {
    const settings = await read($, settingsAtom)
    const now = await read($, moodAtom)
    const level = await read($, levelAtom)
    const line = await read($, lineAtom)
    const width = e.props.bodyColumns
    const columns = Math.max(14, Math.min(40, width - 2))
    const rows = Math.ceil(columns / 2)
    const state = { idle: 'listening', working: 'thinking', speaking: 'speaking' }[now]
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
