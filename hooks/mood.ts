// HAL's mood moves by itself, on what really happens. The owner only sets the ceiling.
// Floor 1 (watchful), start 2. Real signals push it up; calm work lets it sink.
import type { HalLevel } from '../types'

export type MoodEvent = 'abort' | 'failure' | 'forcePush' | 'calmTurn' | 'lateTurn'

const STEP: Record<MoodEvent, number> = {
  abort: 0.6,
  failure: 0.2,
  forcePush: 0.8,
  calmTurn: -0.15,
  lateTurn: 0.25,
}

export const MOOD_START = 2

export const clampMood = (score: number, ceiling: HalLevel) => Math.min(ceiling, Math.max(1, score))

export const moveMood = (score: number, event: MoodEvent, ceiling: HalLevel) =>
  clampMood(score + STEP[event], ceiling)

/** Between visits the mood drifts halfway back toward its start. */
export const returnMood = (score: number | undefined, ceiling: HalLevel) =>
  clampMood(score === undefined ? MOOD_START : score + (MOOD_START - score) / 2, ceiling)

export const isLateHour = (hour: number) => hour >= 23 || hour < 5

export function moodLevel(score: number, ceiling: HalLevel, isLate: boolean): HalLevel {
  const level = Math.max(Math.round(score), isLate ? 2 : 1)

  return Math.min(ceiling, Math.max(1, level)) as HalLevel
}

/** A git push that overwrites history: --force, --force-with-lease, -f, or a +refspec. */
export function isForcePush(command: string): boolean {
  return command
    .split(/&&|\|\||;|\n/)
    .some(part => /\bgit\b.*\bpush\b/.test(part) && /(\s--force(-with-lease)?\b|\s-[a-zA-Z]*f\b|\s\+\S)/.test(part))
}
