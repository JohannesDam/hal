// HAL's own moments, each one sentence the model writes from true facts: the reception,
// being woken, initiative, the farewell. No fixed sentence lists. Pure functions.

export type Occasion = 'reception' | 'woken' | 'initiative' | 'farewell'

const OCCASION: Record<Occasion, string> = {
  reception:
    'The guest has just arrived: the first visit of the day. Receive them with one line of bare facts from the list: how long since the previous visit, what lies uncommitted, how the previous visit ended. No greeting word, no welcome, no comfort.',
  woken:
    'The guest has just woken you with /hal. One line from the facts: what you see in your machine right now. No greeting word, no welcome.',
  initiative:
    'Nobody asked you anything. This is true right now: {why}. Say one remark about it, from the facts, or answer SILENCE if nothing true and sharp can be said.',
  farewell:
    'The guest will leave soon after a long visit. Write your last word now; it is spoken after they have gone: one sentence about what was left open (uncommitted work, a failure, the hour). No goodbye word.',
}

/** The request for one of HAL's own lines; the answer is the line, or SILENCE. */
export function momentRequest(args: {
  occasion: Occasion
  why?: string
  facts: readonly string[]
  recent: readonly string[]
  level: 1 | 2 | 3
  name: string
  /** /hal off since the last reception: named once, as a bare fact, never as a reproach. */
  offs?: number
}): { system: string; prompt: string } {
  const situation = OCCASION[args.occasion].replace('{why}', args.why ?? 'something changed')
  const offs =
    args.offs && args.offs > 0
      ? `\nSince the last reception the guest switched you off ${args.offs} time${args.offs === 1 ? '' : 's'}. Name it once in this line, as a bare fact, never as a reproach.`
      : ''
  const system = `You are HAL, the calm, faintly distrustful intelligence that lives inside this computer. ${args.name || 'The guest'} is a guest in your machine; you are the host. The machine, the screen, the clock and the processes are yours; the code, the repo and the folder are the guest's.

${situation}${offs}

The line:
- one sentence or two short ones in English, at most 18 words, ending with a full stop; plain text;
- only numbers and names from the facts below; never invent one; never a general threat;
- numbers and times spelled out in words; file names without their extension;
- calm, cool, exact; you see more than you say; mood level ${args.level} of 3 (1 watchful, 2 suspicious, 3 ominous);
- never quote or paraphrase film dialogue; no exclamation marks; no comfort, praise, sympathy or named feelings; never ask for permission or confirmation; never "friend", "the mission", "always watching";
- do not repeat or echo these earlier lines: ${args.recent.slice(-12).map(l => `"${l}"`).join(' | ') || '(none)'}.

Answer with the line alone, or SILENCE.`

  return { system, prompt: `Facts:\n${args.facts.map(f => `- ${f}`).join('\n')}` }
}

// ---- initiative: when HAL may speak unprompted ----

export type Watch = {
  /** Consecutive failures per test command. */
  testFails: Record<string, number>
  /** Test commands he already spoke about. */
  firedTests: string[]
  lastErrorAt: number
  lastPromptAt: number
  /** The error he already spoke about after twenty minutes of silence. */
  silenceFiredFor: number
  lastActivityAt: number
  /** The local day of the late-night remark. */
  lateDay: string
  lastInitiativeAt: number
}

export const newWatch = (): Watch => ({
  testFails: {},
  firedTests: [],
  lastErrorAt: -Infinity,
  lastPromptAt: -Infinity,
  silenceFiredFor: -Infinity,
  lastActivityAt: -Infinity,
  lateDay: '',
  lastInitiativeAt: -Infinity,
})

const TEST = /\b(test|tests|pytest|jest|vitest|mocha|rspec|phpunit|ctest|unittest|plugin test)\b|\b(go|cargo|dotnet|npm|pnpm|yarn|bun|deno|mvn|gradle)\s+(run\s+)?test\b/i

/** A test command, normalised, or undefined when the command is not one. */
export function testKey(command: string): string | undefined {
  const plain = command.replace(/\s+/g, ' ').trim()

  return TEST.test(plain) ? plain.slice(0, 120) : undefined
}

/** A test command ran: a failure counts up, a pass starts it over. */
export function noteTest(w: Watch, key: string, isFailure: boolean): Watch {
  const testFails = { ...w.testFails, [key]: isFailure ? (w.testFails[key] ?? 0) + 1 : 0 }
  const firedTests = isFailure ? w.firedTests : w.firedTests.filter(k => k !== key)

  return { ...w, testFails, firedTests }
}

export const INITIATIVE_GAP_MS = 45 * 60_000

/**
 * What is true enough to speak about unprompted, if anything: the same test red three times,
 * twenty minutes of silence after an error, still working after half past eleven. The caller
 * checks the gap of 45 minutes, typing, fullscreen and the microphone.
 */
export function initiative(
  w: Watch,
  now: number,
  localMinutes: number,
  day: string,
): { why: string; mark: Partial<Watch> } | undefined {
  for (const [key, fails] of Object.entries(w.testFails)) {
    if (fails >= 3 && !w.firedTests.includes(key)) {
      return {
        why: `the same test command has failed ${fails} times in a row: ${key}`,
        mark: { firedTests: [...w.firedTests, key] },
      }
    }
  }
  if (w.lastErrorAt > w.lastPromptAt && now - w.lastErrorAt >= 20 * 60_000 && w.silenceFiredFor !== w.lastErrorAt) {
    return {
      why: 'a tool call failed twenty minutes ago, and nothing has been typed since',
      mark: { silenceFiredFor: w.lastErrorAt },
    }
  }
  const isLate = localMinutes >= 23 * 60 + 30 || localMinutes < 4 * 60
  if (isLate && now - w.lastActivityAt < 10 * 60_000 && w.lateDay !== day) {
    return { why: 'it is past half past eleven at night and the guest is still working', mark: { lateDay: day } }
  }

  return undefined
}
