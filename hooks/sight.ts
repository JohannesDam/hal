// HAL sees (/hal see on): what assets/hal-sight.py measured in one look, turned into facts he
// may name. Only numbers come from the look; the picture never left that process.

export type Seen = {
  at: number
  faces: number
  /** The largest face's width as a share of the frame. */
  near?: number
  side?: 'left' | 'centre' | 'right'
  /** 0..1 */
  light: number
  /** -1 (cool, daylight) .. 1 (warm, lamp light) */
  warm: number
  backlit?: boolean
}

/** One look every twenty minutes while the guest is active, and one when he wakes. */
export const LOOK_EVERY_MS = 20 * 60_000

/** The look's JSON line, or undefined when the camera gave nothing usable. */
export function parseSeen(line: string, at: number): Seen | undefined {
  try {
    const raw = JSON.parse(line) as Record<string, unknown>
    if (raw.t !== 'seen' || typeof raw.faces !== 'number' || typeof raw.light !== 'number') {
      return undefined
    }
    const side = raw.side === 'left' || raw.side === 'centre' || raw.side === 'right' ? raw.side : undefined

    return {
      at,
      faces: raw.faces,
      near: typeof raw.near === 'number' ? raw.near : undefined,
      side,
      light: raw.light,
      warm: typeof raw.warm === 'number' ? raw.warm : 0,
      backlit: raw.backlit === true,
    }
  } catch {
    return undefined
  }
}

const distance = (near: number) => (near >= 0.3 ? 'very close to the screen' : near >= 0.18 ? 'at arm’s length' : 'leaning back, far from the screen')
const lightWords = (s: Seen) => {
  if (s.light < 0.08) {
    return 'the room is dark; only the screen lights the guest'
  }
  const level = s.light < 0.25 ? 'dim' : s.light > 0.6 ? 'bright' : 'moderate'
  const kind = s.warm > 0.35 ? 'warm lamp light' : s.warm < -0.1 ? 'cool daylight' : 'neutral light'

  return `${level} ${kind}`
}

/** The facts of the last look and what changed since the one before. Never more than this. */
export function sightFacts(last: Seen | undefined, before: Seen | undefined, clock: (at: number) => string): string[] {
  if (!last) {
    return []
  }
  const who =
    last.faces === 0
      ? 'no one at the desk'
      : last.faces === 1
        ? `one face, ${distance(last.near ?? 0.18)}${last.side && last.side !== 'centre' ? `, to the ${last.side} of the screen` : ''}`
        : `${last.faces} faces: someone else is there with the guest`
  const facts = [`Webcam, one look at ${clock(last.at)} (measured on this machine, nothing kept): ${who}; ${lightWords(last)}${last.backlit ? '; a bright window or lamp behind the guest' : ''}.`]
  if (before) {
    const then = clock(before.at)
    if (before.faces === 0 && last.faces > 0) {
      facts.push(`At ${then} the desk was empty.`)
    } else if (before.faces > 0 && last.faces === 0) {
      facts.push(`At ${then} the guest was still at the desk.`)
    }
    if (before.faces < 2 && last.faces >= 2) {
      facts.push(`At ${then} the guest was alone.`)
    } else if (before.faces >= 2 && last.faces === 1) {
      facts.push(`At ${then} someone else was there; now the guest is alone.`)
    }
    if (before.light - last.light > 0.15) {
      facts.push(`The room was brighter at ${then}.`)
    } else if (last.light - before.light > 0.15) {
      facts.push(`The room was darker at ${then}.`)
    }
    if (before.near !== undefined && last.near !== undefined && last.near - before.near > 0.08) {
      facts.push(`The guest sits closer to the screen than at ${then}.`)
    }
  }

  return facts
}
