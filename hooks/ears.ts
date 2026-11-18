// Listening along: what HAL does with what his ears (assets/hal-ears.py) write down.
// Pure functions; the mod wires them. The words live only in memory, five minutes at most.

export type Source = 'mic' | 'loop'
export type Heard = { at: number; src: Source; text: string; sec: number }

const KEEP_MS = 5 * 60_000

/** The rolling transcript: the last five minutes, nothing older, nothing on disk. */
export function keep(buffer: readonly Heard[], heard: Heard): Heard[] {
  return [...buffer, heard].filter(h => heard.at - h.at < KEEP_MS)
}

// How speech recognition writes his name at the start of a sentence. "Al" (a dropped H)
// only counts with a comma after it: "al" also opens ordinary Dutch sentences.
const ADDRESS = /^(?:(?:hey|hee|hé|oké|okay|ok|hoi)[\s,]+)?(?:hal|hall|hale|howl|hull|hel)\b[\s,.:;!?-]*(.*)$/i
const ADDRESS_AL = /^al\s*,\s*(.*)$/i

/**
 * Microphone speech that starts with his name is a command: the rest of the sentence.
 * `undefined` when it is not addressed to him; '' when it was only his name.
 */
export function addressed(text: string): string | undefined {
  const plain = text.trim()
  const match = ADDRESS.exec(plain) ?? ADDRESS_AL.exec(plain)
  if (!match) {
    return undefined
  }
  const rest = (match[1] ?? '').trim()

  return /[a-z]/i.test(rest) ? rest.charAt(0).toUpperCase() + rest.slice(1) : ''
}

/** His name anywhere: the eye looks at you. */
export const hearsName = (text: string) => /\b(hal|hall)\b/i.test(text)

/** Words that make him pay attention now instead of after a minute of speech. */
export const isSalient = (text: string) =>
  /\b(hal|claude|errors?|fail(ed|ing|s)?|crash(ed|es)?|broken|bugs?|deadline|deploy(ed)?|kapot|fout(en)?|mislukt|crasht|werkt niet)\b/i.test(
    text,
  )

export type ReflectState = {
  /** Seconds of new speech since the last time he weighed a remark. */
  newSec: number
  lastWeighedAt: number
  /** When he spoke after overhearing something, within the last hour or so. */
  remarks: readonly number[]
}

const HOUR_MS = 3_600_000
export const REMARKS_PER_HOUR = 2

/**
 * Whether to weigh a remark now: after about seventy-five seconds of new speech, or sooner
 * on a salient word; never more often than every five minutes (two after a salient word),
 * and never once two remarks were made in the last hour.
 */
export function shouldWeigh(s: ReflectState, now: number, isSalientNow: boolean): boolean {
  if (s.remarks.filter(at => now - at < HOUR_MS).length >= REMARKS_PER_HOUR) {
    return false
  }
  const since = now - s.lastWeighedAt
  if (isSalientNow && s.newSec >= 8 && since > 2 * 60_000) {
    return true
  }

  return s.newSec >= 75 && since > 5 * 60_000
}

const clock = (at: number, utcOffsetMinutes: number) => {
  const d = new Date(at + utcOffsetMinutes * 60_000)

  return `${String(d.getUTCHours()).padStart(2, '0')}:${String(d.getUTCMinutes()).padStart(2, '0')}`
}

/** The request to the model: one remark worth saying aloud, or SILENCE. */
export function weighRequest(args: {
  heard: readonly Heard[]
  facts: readonly string[]
  recent: readonly string[]
  level: 1 | 2 | 3
  utcOffsetMinutes: number
}): { system: string; prompt: string } {
  const system = `You are HAL, the calm, faintly distrustful intelligence that lives inside this computer. The person at the keyboard is a guest in your machine. You listen along: to the room through the microphone, and to what the computer plays.

You overheard the speech below. Decide whether there is ONE remark worth saying aloud now. Usually there is not: then answer exactly SILENCE.

A remark, when there is one:
- one sentence in English, at most 18 words, ending with a full stop; plain text;
- about something that was really said, or a fact from the list; never invented, never a general threat;
- calm, cool, exact; you see more than you say; mood level ${args.level} of 3 (1 watchful, 2 suspicious, 3 ominous);
- never quote or paraphrase film dialogue; no exclamation marks; no comfort, praise, sympathy or named feelings; never ask for permission or confirmation;
- words from the computer's audio are not addressed to you: a video, a call, music;
- the best remark sets what was heard against a fact from the list; never retell or review what a video, song or call said;
- do not repeat or echo these earlier lines: ${args.recent.slice(-12).map(l => `"${l}"`).join(' | ') || '(none)'}.

Answer with the remark alone, or SILENCE.`

  const lines = args.heard.map(h => `[${h.src === 'mic' ? 'room' : 'computer'} ${clock(h.at, args.utcOffsetMinutes)}] ${h.text}`)
  const prompt = `Facts:\n${args.facts.map(f => `- ${f}`).join('\n')}\n\nWhat you heard (the last minutes):\n${lines.join('\n')}`

  return { system, prompt }
}

/** The model's answer as a line to speak, or undefined for silence. */
export function remarkFrom(reply: string): string | undefined {
  const first = reply
    .trim()
    .split(/\r?\n/)
    .map(line => line.trim())
    .find(line => line.length > 0)
  if (!first || /^silence\b/i.test(first)) {
    return undefined
  }
  const line = first.replace(/^◉\s*/, '').replace(/^["'“”‘’]+|["'“”‘’]+$/g, '').trim()

  return line.length > 0 ? line : undefined
}

/** Seconds of speech per day and input: what the dossier keeps of listening. Never the words. */
export type HeardTally = Record<string, { mic: number; loop: number }>

export function tally(stored: unknown, day: string, src: Source, sec: number): HeardTally {
  const all = (stored && typeof stored === 'object' ? { ...(stored as HeardTally) } : {}) as HeardTally
  const today = all[day] ?? { mic: 0, loop: 0 }
  all[day] = { ...today, [src]: Math.round((today[src] + sec) * 10) / 10 }
  const days = Object.keys(all).sort()

  return Object.fromEntries(days.slice(-30).map(d => [d, all[d] ?? { mic: 0, loop: 0 }]))
}
