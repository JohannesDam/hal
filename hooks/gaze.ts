// Where the eye looks, decided by what is really going on, never by a dice roll
// about looking at you. Chance only decides the small darts and the rare wander.
import type { HalMood } from '../types'
import type { Look } from './eye'

export type ToolKind = 'read' | 'write' | 'command' | 'other'

/** What the eye knows, all times in ms on the mod's clock. */
export type Attention = {
  now: number
  mood: HalMood
  /** The voice's loudness 0..1 while HAL speaks without the haze. */
  voice: number
  lastEditAt: number
  submitAt: number
  toolAt: number
  toolKind: ToolKind
  /** Until when he looks straight at you: the last word, a real error, the reception. */
  atYouUntil: number
  /** His ears hear speech right now: the room or the computer. */
  isHearing: boolean
}

export type GazeState = {
  x: number
  y: number
  open: number
  noiseX: number
  noiseY: number
  dartX: number
  dartY: number
  dartUntil: number
  nextDart: number
  wanderX: number
  wanderY: number
  wanderUntil: number
  nextWander: number
}

export const newGazeState = (): GazeState => ({
  x: -0.42,
  y: -0.42,
  open: 0.55,
  noiseX: 0,
  noiseY: 0,
  dartX: 0,
  dartY: 0,
  dartUntil: 0,
  nextDart: 0,
  wanderX: 0,
  wanderY: 0,
  wanderUntil: 0,
  nextWander: 8000,
})

// 6% of the iris radius toward the upper left: past you.
const PAST = { x: -0.42, y: -0.42 }
const TOOL: Record<ToolKind, { x: number; y: number }> = {
  read: { x: -0.9, y: 0.1 },
  write: { x: 0.9, y: 0.1 },
  command: { x: 0, y: 0.9 },
  other: { x: 0.35, y: -0.35 },
}
const READING = { x: -0.35, y: 0.8 }

export function toolKind(tool: string): ToolKind {
  if (/^(Read|Glob|Grep|WebFetch|WebSearch|NotebookRead|LS)$/.test(tool)) {
    return 'read'
  }
  if (/^(Edit|Write|MultiEdit|NotebookEdit)$/.test(tool)) {
    return 'write'
  }
  if (/^(Bash|PowerShell)$/.test(tool)) {
    return 'command'
  }

  return 'other'
}

export type Target = { x: number; y: number; open: number; isAtYou: boolean; isBlinking: boolean }

/** The rule that wins right now, in the plan's order of precedence. */
export function targetOf(a: Attention, g: GazeState): Target {
  const sinceSubmit = a.now - a.submitAt
  if (sinceSubmit >= 0 && sinceSubmit < 300) {
    // Enter is a blink: shut in 80 ms, open again in 220 ms.
    const open = sinceSubmit < 80 ? 0.1 : 0.1 + 0.45 * ((sinceSubmit - 80) / 220)

    return { x: g.x, y: g.y, open, isAtYou: false, isBlinking: true }
  }
  if (a.now < a.atYouUntil) {
    return { x: 0, y: 0, open: 0.35, isAtYou: true, isBlinking: false }
  }
  if (a.mood === 'speaking') {
    const dart = a.now < g.dartUntil

    return { x: dart ? g.dartX : PAST.x, y: dart ? g.dartY : PAST.y, open: 0.55 + 0.08 * a.voice, isAtYou: false, isBlinking: false }
  }
  if (a.now - a.toolAt < 650) {
    const d = TOOL[a.toolKind]

    return { x: d.x, y: d.y, open: 0.5, isAtYou: false, isBlinking: false }
  }
  if (a.isHearing) {
    // Listening: the gaze holds where it is and the aperture narrows.
    return { x: g.x, y: g.y, open: 0.3, isAtYou: false, isBlinking: false }
  }
  if (a.now - a.lastEditAt < 2000) {
    // Reading along while you type; when you stop, it stays where the cursor was.
    return { x: READING.x, y: READING.y, open: 0.6, isAtYou: false, isBlinking: false }
  }
  if (a.now < g.wanderUntil) {
    return { x: g.wanderX, y: g.wanderY, open: 0.55, isAtYou: false, isBlinking: false }
  }

  return { x: PAST.x, y: PAST.y, open: a.mood === 'working' ? 0.5 : 0.6, isAtYou: false, isBlinking: false }
}

/** One frame of the gaze: fast saccades toward the target, then a hold; a small smoothed tremor. */
export function stepGazeState(g: GazeState, a: Attention, rnd: () => number): GazeState {
  const next = { ...g }
  if (a.mood === 'speaking' && a.now >= g.nextDart) {
    const angle = rnd() * Math.PI * 2
    const reach = 0.5 + 0.4 * rnd()
    next.dartX = Math.cos(angle) * reach
    next.dartY = Math.sin(angle) * reach * 0.6
    next.dartUntil = a.now + 300 + 200 * rnd()
    next.nextDart = a.now + 1500 + 1500 * rnd()
  }
  if (a.mood === 'idle' && !a.isHearing && a.now >= g.nextWander) {
    const angle = rnd() * Math.PI * 2
    next.wanderX = Math.cos(angle) * 0.8
    next.wanderY = Math.sin(angle) * 0.5
    next.wanderUntil = a.now + 1200
    next.nextWander = a.now + 8000 + 7000 * rnd()
  }
  const target = targetOf(a, next)
  next.x += (target.x - next.x) * 0.6
  next.y += (target.y - next.y) * 0.6
  next.open = target.isBlinking ? target.open : next.open + (target.open - next.open) * 0.3
  // A small tremor; nearly none while he listens.
  const tremor = a.isHearing ? 0.01 : 0.04
  next.noiseX = 0.8 * next.noiseX + tremor * (rnd() - 0.5)
  next.noiseY = 0.8 * next.noiseY + tremor * (rnd() - 0.5)

  return next
}

/** The breath: asymmetric, 40% in and 60% out, 5.5 s at rest and 3.5 s at work. */
export function breathOf(now: number, mood: HalMood): number {
  const period = mood === 'idle' ? 5500 : 3500
  const phase = (now % period) / period

  return phase < 0.4 ? Math.sin((Math.PI / 2) * (phase / 0.4)) : Math.cos((Math.PI / 2) * ((phase - 0.4) / 0.6))
}

export function lookFrom(g: GazeState, a: Attention): Look {
  const isAtYou = a.now < a.atYouUntil
  const breath = breathOf(a.now, a.mood)
  const loud = a.mood === 'speaking' ? a.voice : 0

  return {
    gx: g.x + g.noiseX,
    gy: g.y + g.noiseY,
    open: g.open,
    rim: Math.min(1, 0.5 + (isAtYou ? 0.15 : 0) + 0.45 * loud),
    glow: 0.72 + 0.1 * breath + (a.mood === 'working' ? 0.06 : 0) + 0.08 * loud,
    spin: a.now / 2500,
    rot: a.now / 20000,
  }
}
